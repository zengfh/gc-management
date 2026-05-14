interface ErrorLike {
  code?: string;
  message?: string;
  fieldErrors?: unknown[];
  details?: unknown;
}

export function objectResponse<T>(data: T) {
  return { data };
}

export function errorResponse(error: ErrorLike, requestId?: string) {
  return {
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'Unexpected server error.',
      fieldErrors: error.fieldErrors || [],
      ...(error.details === undefined ? {} : { details: error.details }),
      requestId,
    },
  };
}
