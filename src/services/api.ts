const BASE_URL = "http://localhost:8000";

// 🔥 helper to handle responses
const handleResponse = async (res: Response) => {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "API request failed");
  }
  return res.json();
};

// ================= DASHBOARD =================
export const getDashboard = async (refresh = false) => {
  const url = refresh
    ? `${BASE_URL}/dashboard?refresh=true`
    : `${BASE_URL}/dashboard`;

  const res = await fetch(url, {
    credentials: "include",
  });

  return handleResponse(res);
};

// ================= EMAILS =================
export const getEmails = async (refresh = false, pageToken?: string, limit = 50, since?: number) => {
  const params = new URLSearchParams();
  if (refresh) params.append("refresh", "true");
  if (pageToken) params.append("pageToken", pageToken);
  if (since && since > 0) params.append("since", since.toString());
  params.append("limit", limit.toString());

  const url = `${BASE_URL}/emails?${params.toString()}`;

  const res = await fetch(url, {
    credentials: "include",
  });

  return handleResponse(res);
};

// ================= VIP RULES =================

// 🔥 GET VIP LIST
export const getVipList = async () => {
  const res = await fetch(`${BASE_URL}/rules/high-priority-senders`, {
    credentials: "include",
  });

  return handleResponse(res);
};

// 🔥 ADD VIP
export const markSenderHighPriority = async (senderEmail: string) => {
  const res = await fetch(`${BASE_URL}/rules/high-priority-senders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ sender_email: senderEmail }),
  });

  return handleResponse(res);
};

// 🔥 REMOVE VIP (existing)
export const removeSenderHighPriority = async (senderEmail: string) => {
  const res = await fetch(`${BASE_URL}/rules/high-priority-senders`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ sender_email: senderEmail }),
  });

  return handleResponse(res);
};

// 🔥 ALIAS (so your EmailList code works without breaking)
export const removeVipSender = removeSenderHighPriority;


// ================= MEDIUM PRIORITY =================

// 🔥 ADD MEDIUM
export const addMediumSender = async (senderEmail: string) => {
  const res = await fetch(`${BASE_URL}/priority/medium`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ email: senderEmail }),
  });

  return handleResponse(res);
};

// 🔥 REMOVE MEDIUM
export const removeMediumSender = async (senderEmail: string) => {
  const res = await fetch(`${BASE_URL}/priority/medium`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ email: senderEmail }),
  });

  return handleResponse(res);
};

// 🔥 GET MEDIUM LIST (optional for future use)
export const getMediumList = async () => {
  const res = await fetch(`${BASE_URL}/priority/medium`, {
    credentials: "include",
  });

  return handleResponse(res);
};


// ================= AI REPLY =================

export const getSuggestedReply = async (subject: string, snippet: string, sender: string) => {
  const res = await fetch(`${BASE_URL}/emails/suggest-reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ subject, snippet, sender }),
  });
  return handleResponse(res);
};

export const sendReply = async (payload: {
  to: string;
  subject: string;
  body: string;
  thread_id?: string;
  message_id_header?: string;
}) => {
  const res = await fetch(`${BASE_URL}/emails/send-reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

// ================= FOLLOW-UPS =================

export const getFollowups = async () => {
  const res = await fetch(`${BASE_URL}/followups`, {
    credentials: "include",
  });
  return handleResponse(res);
};

export const markFollowupDone = async (threadId: string) => {
  const res = await fetch(
    `${BASE_URL}/followups/${encodeURIComponent(threadId)}/done`,
    {
      method: "POST",
      credentials: "include",
    }
  );
  return handleResponse(res);
};