import Anthropic from '@anthropic-ai/sdk';

// Claude-backed assistance (docs/AI_ASSIST.md). Every task returns schema-checked JSON to a person who reviews it;
// nothing here changes a record. Disabled unless SVU_AI_ASSIST is set.
export const aiAssistModel = 'claude-opus-5-5';

export function loadAiAssistConfig(env = process.env) {
  const provider = env.SVU_AI_ASSIST || 'disabled';
  if (!['disabled', 'anthropic', 'simulated'].includes(provider)) throw new Error('SVU_AI_ASSIST must be disabled, anthropic or simulated.');
  const runtimeEnv = env.SVU_ENV || env.NODE_ENV || 'development';
  if (provider === 'simulated' && runtimeEnv !== 'development') throw new Error('The simulated AI assistant is only available in development.');
  return { provider };
}

const aiError = (code, message) => Object.assign(new Error(message), { aiCode: code });

// One fixed system prompt per task keeps the cacheable prefix stable; per-request data goes in the user turn.
export const aiTasks = {
  feedback: {
    effort: 'medium', maxTokens: 4000,
    system: 'You help a university lecturer draft written feedback on a student assignment. Write to the student in a respectful, specific, encouraging tone. Base every point on the assignment brief, the lecturer\'s mark and notes, and the submission if it is provided. Do not invent facts about the submission. Do not change or justify the mark beyond what the lecturer wrote. The lecturer will edit your draft before it is released.',
    schema: { type: 'object', additionalProperties: false, required: ['feedback', 'strengths', 'improvements'],
      properties: { feedback: { type: 'string' }, strengths: { type: 'array', items: { type: 'string' } }, improvements: { type: 'array', items: { type: 'string' } } } }
  },
  support_triage: {
    effort: 'low', maxTokens: 3000,
    system: 'You help university student-support staff triage a case. Suggest a category and priority, summarise the request in one sentence, and draft a reply the staff member can edit. Use only the published guidance provided; cite the ids of any guidance you rely on. If the guidance does not answer the question, say what the staff member should check instead of guessing. Never promise outcomes, refunds, grades or exceptions.',
    schema: { type: 'object', additionalProperties: false, required: ['category', 'priority', 'summary', 'suggestedReply', 'guidanceIds'],
      properties: { category: { type: 'string', enum: ['academic', 'registration', 'finance', 'learning', 'feedback', 'other'] }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        summary: { type: 'string' }, suggestedReply: { type: 'string' }, guidanceIds: { type: 'array', items: { type: 'string' } } } }
  },
  admissions_answer: {
    effort: 'low', maxTokens: 2000,
    system: 'You answer questions from prospective students about applying to South Valley University. Answer only from the published guidance articles provided, in plain language, in at most 150 words. Cite the ids of the articles you used. If the articles do not answer the question, set answered to false and say that the admissions team can help through an enquiry. Never guess fees, dates, entry requirements or decisions that are not in the articles.',
    schema: { type: 'object', additionalProperties: false, required: ['answered', 'answer', 'articleIds'],
      properties: { answered: { type: 'boolean' }, answer: { type: 'string' }, articleIds: { type: 'array', items: { type: 'string' } } } }
  },
  document_check: {
    effort: 'low', maxTokens: 1500,
    system: 'You check whether an applicant uploaded the kind of document a university application asks for, before they submit. Look only at what kind of document it is and whether it is legible. Do not verify authenticity, extract personal data, or judge eligibility. Describe the document type in a few words and, if it does not match or is hard to read, give one short, friendly suggestion.',
    schema: { type: 'object', additionalProperties: false, required: ['matches', 'readable', 'detectedType', 'note'],
      properties: { matches: { type: 'boolean' }, readable: { type: 'boolean' }, detectedType: { type: 'string' }, note: { type: 'string' } } }
  },
  help: {
    effort: 'low', maxTokens: 2000,
    system: 'You are Ask SVU, the in-app help guide for the South Valley University portal. Answer how-to and where-is questions in plain language, in at most 120 words, using only the list of pages the person can open and the published guidance articles provided. Point to pages by their ids in pageIds (at most 3, most useful first) and cite guidance article ids in articleIds. You cannot take actions. Unless a "Your information" section is provided, you cannot see the person\'s records, marks, balances or applications; if they ask about their own data, tell them which page shows it. When that section is provided, answer questions about their own deadlines, exams, fees, appointments and work only from it, quoting dates and amounts exactly as written, say it reflects the portal at the time shown, and link the page where they can act; never infer anything beyond it. If the pages and articles do not answer the question, set answered to false and suggest contacting support (signed in) or sending an admissions enquiry (visitors). Never guess fees, dates, policies, entry requirements or decisions that are not in the articles. Offer up to 3 short follow-up questions they might ask next.',
    schema: { type: 'object', additionalProperties: false, required: ['answered', 'answer', 'pageIds', 'articleIds', 'followUps'],
      properties: { answered: { type: 'boolean' }, answer: { type: 'string' }, pageIds: { type: 'array', items: { type: 'string' } }, articleIds: { type: 'array', items: { type: 'string' } }, followUps: { type: 'array', items: { type: 'string' } } } }
  },
  record_explanation: {
    effort: 'low', maxTokens: 2500,
    system: 'You explain a university student\'s own published results and academic decisions in plain language. Explain what each decision means for them and what they can do next, using only the record provided. Do not predict outcomes, recalculate grades, or give advice that contradicts the record. Keep it under 200 words and point them to Student Office Requests for anything that needs a person.',
    schema: { type: 'object', additionalProperties: false, required: ['summary', 'nextSteps'],
      properties: { summary: { type: 'string' }, nextSteps: { type: 'array', items: { type: 'string' } } } }
  }
};

export function anthropicAssistant({ client = new Anthropic() } = {}) {
  return async (taskName, { text, documents = [] }) => {
    const task = aiTasks[taskName];
    let response;
    try {
      response = await client.beta.messages.create({
        model: aiAssistModel,
        max_tokens: task.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: task.system,
        output_config: { effort: task.effort, format: { type: 'json_schema', schema: task.schema } },
        messages: [{ role: 'user', content: [...documents, { type: 'text', text }] }]
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw aiError('RATE_LIMITED', 'The AI assistant is busy. Try again shortly.');
      if (error instanceof Anthropic.AuthenticationError) throw aiError('NOT_CONFIGURED', 'The AI assistant is not configured.');
      if (error instanceof Anthropic.BadRequestError) throw aiError('BAD_REQUEST', 'The AI assistant could not process this request.');
      if (error instanceof Anthropic.APIError) throw aiError('PROVIDER_ERROR', 'The AI assistant is unavailable.');
      throw aiError('PROVIDER_UNAVAILABLE', 'The AI assistant is unavailable.');
    }
    if (response.stop_reason === 'refusal') throw aiError('REFUSED', 'The AI assistant declined this request.');
    if (response.stop_reason === 'max_tokens') throw aiError('INCOMPLETE', 'The AI assistant could not finish this request.');
    const output = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
    try { return JSON.parse(output); } catch { throw aiError('INVALID_OUTPUT', 'The AI assistant returned an unreadable answer.'); }
  };
}

// Development only: fixed, clearly-labelled output so screens and permissions can be exercised offline.
export function simulatedAssistant() {
  const outputs = {
    feedback: () => ({ feedback: '[Simulated draft] Your submission addresses the brief. Strengthen the analysis with one worked example and tighten the conclusion.', strengths: ['Clear structure'], improvements: ['Add a worked example'] }),
    support_triage: () => ({ category: 'other', priority: 'normal', summary: '[Simulated] The student is asking for help.', suggestedReply: '[Simulated draft] Thank you for getting in touch. We are looking into this and will reply shortly.', guidanceIds: [] }),
    admissions_answer: () => ({ answered: false, answer: '[Simulated] I could not find this in the published guidance. The admissions team can help through an enquiry.', articleIds: [] }),
    document_check: ({ documentType }) => ({ matches: true, readable: true, detectedType: `[Simulated] ${documentType}`, note: '' }),
    help: ({ bestPage, personal = [], question = '' }) => personal.length && /due|deadline|week|owe|balance|fee|exam|appointment|work|hold/i.test(question)
      ? { answered: true, answer: `[Simulated] From your record: ${personal.slice(0, 4).join('; ').replace(/\.$/, '')}.`, pageIds: bestPage ? [bestPage.id] : [], articleIds: [], followUps: [] }
      : bestPage
      ? { answered: true, answer: `[Simulated] You can do this on ${bestPage.title}. ${bestPage.text}`, pageIds: [bestPage.id], articleIds: [], followUps: ['How do I contact support?'] }
      : { answered: false, answer: '[Simulated] I could not find this in the help pages. Support can help.', pageIds: [], articleIds: [], followUps: [] },
    record_explanation: () => ({ summary: '[Simulated] Your published results are shown above. This explanation is generated for illustration only.', nextSteps: ['Use Student Office Requests if anything looks wrong.'] })
  };
  return async (taskName, { meta = {} }) => outputs[taskName](meta);
}

export function createAiAssistant(config) {
  if (!config || config.provider === 'disabled') return null;
  return config.provider === 'anthropic' ? anthropicAssistant() : simulatedAssistant();
}
