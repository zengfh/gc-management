export function objectResponse(data) {
  return { data };
}

export function errorResponse(error, requestId) {
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
