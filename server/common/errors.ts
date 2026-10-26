/** An error with an HTTP status. Rendered as the standard { statusCode, message, error } body. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string | string[] = STATUS_NAMES[status] ?? "Error") {
    super(Array.isArray(message) ? message.join(", ") : message);
    this.messages = message;
  }

  readonly messages: string | string[];
}

const STATUS_NAMES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  413: "Payload Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

export const badRequest = (message: string | string[]) => new HttpError(400, message);
export const forbidden = (message?: string) => new HttpError(403, message ?? "Forbidden");
export const notFound = () => new HttpError(404, "Not Found");

export function errorBody(err: HttpError) {
  return {
    statusCode: err.status,
    message: err.messages,
    error: STATUS_NAMES[err.status] ?? "Error",
  };
}
