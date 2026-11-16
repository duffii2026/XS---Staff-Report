import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeExternals from 'webpack-node-externals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  mode: 'production',
  target: ['node', 'es2022'],
  entry: './index.js',
  experiments: {
    outputModule: true,
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.mjs',
    clean: true,
    module: true,
    library: { type: 'module' },
    chunkFormat: 'module',
  },
  devtool: 'source-map',
  optimization: { minimize: false },
  externalsPresets: { node: true },
  externals: [
    nodeExternals({
      importType: 'module',
    }),
  ],
  resolve: {
    extensions: ['.js', '.mjs', '.cjs', '.json'],
  },
  stats: 'errors-warnings',
};
