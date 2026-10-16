const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

try {
  const admin = await login(adminCredentials);
  const documents = await get("/api/documents?ownerType=Application&ownerId=app_mock_001", admin.token);
  if (documents.data.length === 0) {
    throw new Error("Expected at least one application document.");
  }

  const templates = await get("/api/notifications/templates", admin.token);
  if (templates.data.length === 0) {
    throw new Error("Expected at least one notification template.");
  }

  const notifications = await get("/api/notifications?status=queued", admin.token);

  console.log(JSON.stringify({
    applicationDocuments: documents.data.length,
    notificationTemplates: templates.data.length,
    queuedNotifications: notifications.data.length
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function login(credentials) {
  const response = await post("/api/identity/sessions", credentials);
  return response.data;
}

async function get(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: bearer(token)
  });
  return parseResponse(response);
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}
