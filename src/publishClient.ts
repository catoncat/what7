export interface PublishClientOptions {
  workerUrl: string;
  adminToken?: string;
  fetchImpl?: typeof fetch;
}

export interface PublishRequest {
  title: string;
  html: string;
  sourcePath: string;
  sourceHash: string;
}

export interface PublishResponse {
  id: string;
  url: string;
  deleteToken: string;
  status: "published";
}

export interface UnpublishResponse {
  id: string;
  status: "unpublished";
  url?: string;
}

export class PublishClient {
  private readonly baseUrl: URL;
  private readonly adminToken?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PublishClientOptions) {
    if (!options.workerUrl) throw new Error("workerUrl is required");
    this.baseUrl = new URL(options.workerUrl.endsWith("/") ? options.workerUrl : `${options.workerUrl}/`);
    this.adminToken = options.adminToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async publish(request: PublishRequest): Promise<PublishResponse> {
    if (!this.adminToken) throw new Error("Missing Worker admin token. Set WHAT7_ADMIN_TOKEN or pass --admin-token.");
    const response = await this.fetchImpl(new URL("api/share", this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.adminToken}`,
      },
      body: JSON.stringify(request),
    });
    return parseResponse<PublishResponse>(response, "publish");
  }

  async unpublish(remoteId: string, deleteToken: string): Promise<UnpublishResponse> {
    if (!deleteToken) throw new Error("Missing delete capability for this share.");
    const response = await this.fetchImpl(new URL(`api/share/${encodeURIComponent(remoteId)}/unpublish`, this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-what7-delete-token": deleteToken,
      },
      body: JSON.stringify({ deleteToken }),
    });
    return parseResponse<UnpublishResponse>(response, "unpublish");
  }
}

async function parseResponse<T>(response: Response, action: string): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text.slice(0, 500) };
  }
  if (!response.ok) {
    const message = extractError(payload) ?? `${action} failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function extractError(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>).error ?? (payload as Record<string, unknown>).message;
    if (typeof value === "string") return value;
  }
  return undefined;
}
