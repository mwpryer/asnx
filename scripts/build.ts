const pkg = await Bun.file("package.json").json();

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  root: "src",
  target: "node",
  minify: true,
  naming: "[dir]/index.[ext]",
  banner: "#!/usr/bin/env node",
  external: Object.keys(pkg.dependencies),
  define: {
    __ASX_VERSION__: JSON.stringify(pkg.version),
    __ASX_DESCRIPTION__: JSON.stringify(pkg.description),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Built ${result.outputs.length} files`);
