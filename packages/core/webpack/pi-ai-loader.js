module.exports = function (source) {
  return source.replace(
    /import\s*\(\s*__rewriteRelativeImportExtension\s*\(\s*specifier\s*\)\s*\)/g,
    "import(/* webpackIgnore: true */ __rewriteRelativeImportExtension(specifier))",
  );
};
