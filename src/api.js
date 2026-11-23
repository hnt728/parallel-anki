const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function request(path, data, signal) {
  const response = await fetch(path, {
    signal,
    method: data ? 'POST' : 'GET',
    headers: { 'X-Time-Zone': timeZone, ...(data && { 'Content-Type': 'application/json' }) },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json().catch(() => ({ error: '接続を確認して、ページを読み直してください。' }));
  if (!response.ok || value.error) {
    throw Object.assign(new Error(value.error ?? '通信に失敗しました。'), { state: value.state });
  }
  return value;
}
