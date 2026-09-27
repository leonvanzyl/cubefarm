/** An error the REST layer turns into this status with a JSON { error } body. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
