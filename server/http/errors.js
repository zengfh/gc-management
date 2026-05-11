export class HttpError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fieldErrors = options.fieldErrors || [];
  }
}

export function badRequest(code, message, fieldErrors = []) {
  return new HttpError(400, code, message, { fieldErrors });
}

export function unauthorized(code = 'UNAUTHORIZED', message = 'Unauthorized.') {
  return new HttpError(401, code, message);
}

export function forbidden(code = 'FORBIDDEN', message = 'Forbidden.') {
  return new HttpError(403, code, message);
}

export function conflict(code, message) {
  return new HttpError(409, code, message);
}

export function rateLimited(code, message) {
  return new HttpError(429, code, message);
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
