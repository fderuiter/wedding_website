export class ApiError extends Error {
  public status: number;
  public statusCode: number;
  public data?: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.statusCode = status;
    this.data = data;
    this.name = 'ApiError';
  }
}
