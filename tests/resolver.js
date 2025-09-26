const path = require('path');
const fs = require('fs');

module.exports = (request, options) => {
  // Handle relative imports with .js extensions by converting to .ts
  if (request.startsWith('./') || request.startsWith('../')) {
    if (request.endsWith('.js')) {
      const tsRequest = request.replace(/\.js$/, '.ts');
      const tsPath = path.resolve(options.basedir, tsRequest);

      // Check if .ts file exists
      if (fs.existsSync(tsPath)) {
        return options.defaultResolver(tsRequest, options);
      }
    }
  }

  return options.defaultResolver(request, options);
};