export function parseFormData(buffer: Buffer, boundary: string): Record<string, any> {
    const boundaryDelimiter = `--${boundary}`;
    const endBoundary = `${boundaryDelimiter}--`;
    const parts = buffer
      .toString()
      .split(boundaryDelimiter)
      .filter((part) => part.trim() && part.trim() !== '--' && part.trim() !== endBoundary);
  
    const parsedData: Record<string, any> = {};
  
    for (const part of parts) {
      const [rawHeaders, ...rawBody] = part.split('\r\n\r\n');
      if (!rawHeaders || !rawHeaders.trim()) {
        console.error('No headers found in part');
        continue;
      }
  
      const headers = rawHeaders.split('\r\n');
      const contentDisposition = headers.find((header) => header.startsWith('Content-Disposition'));
  
      if (contentDisposition) {
        const nameMatch = contentDisposition.match(/name="([^"]+)"/);
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
        const name = nameMatch ? nameMatch[1] : undefined;
  
        const body = rawBody.join('\r\n\r\n').trim();
  
        if (name) {
          if (filenameMatch) {
            const filename = filenameMatch[1];
            const fileContentStartIndex = buffer.indexOf('\r\n\r\n', buffer.indexOf(rawHeaders)) + 4;
            const fileContentEndIndex = buffer.indexOf(boundaryDelimiter, fileContentStartIndex) - 2;
            const fileBuffer = buffer.slice(fileContentStartIndex, fileContentEndIndex);
  
            parsedData[name] = { filename, content: fileBuffer };
          } else {
            parsedData[name] = body;
          }
        }
      }
    }
  
    return parsedData;
  }