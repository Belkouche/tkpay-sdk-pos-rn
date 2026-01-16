const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const sdkRoot = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [sdkRoot],
  resolver: {
    extraNodeModules: {
      'react-native-tkpay-naps': sdkRoot,
    },
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(sdkRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
