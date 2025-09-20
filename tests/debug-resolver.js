const { existsSync } = require('fs');
const { resolve } = require('path');

module.exports = function (request, options) {
  console.log(`[DEBUG RESOLVER] Resolving: ${request}`);
  console.log(`[DEBUG RESOLVER] From: ${options.basedir}`);
  console.log(`[DEBUG RESOLVER] Extensions: ${JSON.stringify(options.extensions)}`);

  // Handle relative imports ending in .js by mapping to .ts
  if (request.startsWith('./') && request.endsWith('.js')) {
    const tsPath = request.slice(0, -3) + '.ts';
    const fullTsPath = resolve(options.basedir, tsPath);
    console.log(`[DEBUG RESOLVER] Trying mapped .js to .ts: ${fullTsPath}`);
    if (existsSync(fullTsPath)) {
      console.log(`[DEBUG RESOLVER] Found mapped file: ${fullTsPath}`);
      return fullTsPath;
    }
  }

  // Try to resolve with the original resolver
  const originalResolver = options.defaultResolver;
  try {
    const resolved = originalResolver(request, options);
    console.log(`[DEBUG RESOLVER] Resolved to: ${resolved}`);
    return resolved;
  } catch (error) {
    console.log(`[DEBUG RESOLVER] Resolution failed: ${error.message}`);

    // Try to find the file manually
    const possiblePaths = [
      resolve(options.basedir, request),
      resolve(options.basedir, request + '.ts'),
      resolve(options.basedir, request + '.js'),
      resolve(options.basedir, request + '.d.ts'),
    ];

    console.log(`[DEBUG RESOLVER] Trying paths: ${JSON.stringify(possiblePaths)}`);

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        console.log(`[DEBUG RESOLVER] Found at: ${path}`);
        return path;
      }
    }

    throw error;
  }
};