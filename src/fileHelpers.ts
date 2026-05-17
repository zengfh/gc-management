export function downloadBlobFile(filename: string, blob: Blob): void {
  if (typeof document === 'undefined' || !globalThis.URL?.createObjectURL) {
    return;
  }

  const url = globalThis.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  globalThis.URL.revokeObjectURL?.(url);
}

export function downloadJsonFile(filename: string, payload: unknown): void {
  downloadBlobFile(
    filename,
    new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    }),
  );
}

export function downloadCsvFile(filename: string, csv: string): void {
  downloadBlobFile(
    filename,
    new Blob([csv], {
      type: 'text/csv',
    }),
  );
}

export function readFileText(file: File): Promise<string> {
  if (file?.text) {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('CSV file could not be read.'));
    reader.readAsText(file);
  });
}
