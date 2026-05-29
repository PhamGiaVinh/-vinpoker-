export async function sendTestWebhook(
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

export async function getLastTelegramMessage(
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

    const updates = data.result as any[];
    // Chỉ lấy message sau `since` (unix timestamp) và đúng chatId
    const relevant = updates.filter(
      (u: any) =>
        u.message?.chat?.id == Number(chatId) &&
        u.message?.date >= since,
    );

    if (!relevant.length) return null;
    return relevant[relevant.length - 1].message?.text ?? null;
  } catch {
    return null;
  }
}

export async function waitForTelegramMessage(
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
