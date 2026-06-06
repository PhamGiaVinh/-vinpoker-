type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    date?: number;
    text?: string;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number; is_bot?: boolean; first_name?: string };
  };
};

async function sendTestWebhook(
  botToken: string,
  functionUrl: string,
  secretToken: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secretToken,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true };
    const body = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${body}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function getLastTelegramMessage(
  botToken: string,
  chatId: string,
  since: number,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates?offset=-1&timeout=2`,
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (!data?.result?.length) return null;

    const updates = data.result as TelegramUpdate[];
    // Chỉ lấy message sau `since` (unix timestamp) và đúng chatId
    const relevant = updates.filter(
      (u) =>
        u.message?.chat?.id == Number(chatId) &&
        (u.message?.date ?? 0) >= since,
    );

    if (!relevant.length) return null;
    return relevant[relevant.length - 1].message?.text ?? null;
  } catch {
    return null;
  }
}

async function waitForTelegramMessage(
  botToken: string,
  chatId: string,
  timeoutMs: number,
): Promise<string | null> {
  const since = Math.floor(Date.now() / 1000);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const msg = await getLastTelegramMessage(botToken, chatId, since);
    if (msg) return msg;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}
