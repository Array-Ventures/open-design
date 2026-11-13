/** Embedded UI assets use the host mount; generated project CSS is not processed here. */
module.exports = function embeddedFonts({ basePath = '/studio', fonts = [] } = {}) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath)) throw new Error('Invalid embedded font mount.');
  const approved = new Set(fonts);
  return {
    postcssPlugin: 'embedded-reviewed-fonts',
    AtRule(rule) {
      if (rule.name.toLowerCase() !== 'font-face') return;
      const sources = [];
      rule.walkDecls('src', declaration => {
        for (const match of declaration.value.matchAll(/url\(\s*['"]?\/fonts\/([^)'"\s]+)['"]?\s*\)/g)) sources.push(match[1]);
      });
      if (sources.some(name => !approved.has(name))) { rule.remove(); return; }
      rule.walkDecls('src', declaration => {
        declaration.value = declaration.value.replace(/(["'(])\/fonts\//g, `$1${basePath}/fonts/`);
      });
    },
  };
};
module.exports.postcss = true;
