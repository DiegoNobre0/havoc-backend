export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 400, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Restaura a cadeia de protótipos (necessário ao estender classes nativas no TS)
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this);
  }
}