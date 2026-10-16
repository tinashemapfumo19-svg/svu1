import test from "node:test";
import assert from "node:assert/strict";
import { defaultTemplates, validateTemplateContent } from "../server/modules/document-templates.js";

test("built-in defaults are themselves valid templates",() => {
  for (const kind of ["progressive","certificate"]) assert.deepEqual(validateTemplateContent(kind,defaultTemplates[kind]),defaultTemplates[kind]);
});

test("templates accept only their kind's fields, trimmed and bounded",() => {
  const content = {...defaultTemplates.certificate,signatoryName:"  Dr T. Moyo ",preamble:" This is to certify that "};
  assert.deepEqual(validateTemplateContent("certificate",content),{...defaultTemplates.certificate,signatoryName:"Dr T. Moyo",preamble:"This is to certify that"});
  assert.equal(validateTemplateContent("progressive",{...defaultTemplates.progressive,signatoryName:""}).signatoryName,"");
  for (const [kind,bad] of [["diploma",defaultTemplates.progressive],["progressive",{...defaultTemplates.progressive,preamble:"x"}],["progressive",{...defaultTemplates.progressive,title:" "}],
    ["certificate",{...defaultTemplates.certificate,footerText:"x".repeat(501)}],["certificate",{...defaultTemplates.certificate,conferralText:"has been awarded"}]]) {
    assert.throws(() => validateTemplateContent(kind,bad),{statusCode:400});
  }
});
