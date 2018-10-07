const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const expect = require('chai').expect;
const fse = require('fs-extra');
const glob = require('glob');
const path = require('path');
const tempy = require('tempy');
const vm = require('vm');
const webpack = require('webpack');

const CreateWebpackAssetPlugin = require('../../../infra/testing/create-webpack-asset-plugin');
const validateServiceWorkerRuntime = require('../../../infra/testing/validator/service-worker-runtime');
const {InjectManifest} = require('../../../packages/workbox-webpack-plugin/src/index');
const {getModuleUrl} = require('../../../packages/workbox-build/src/lib/cdn-utils');

describe(`[workbox-webpack-plugin] InjectManifest (End to End)`, function() {
  const WEBPACK_ENTRY_FILENAME = 'webpackEntry.js';
  const WORKBOX_SW_FILE_NAME = getModuleUrl('workbox-sw');
  const SRC_DIR = path.join(__dirname, '..', 'static', 'example-project-1');
  const SW_SRC = path.join(__dirname, '..', 'static', 'sw-src.js');
  const WORKBOX_DIRECTORY_PREFIX = 'workbox-';
  const ALL_WORKBOX_FILES = [
    'workbox-background-sync.dev.js',
    'workbox-background-sync.dev.js.map',
    'workbox-background-sync.prod.js',
    'workbox-background-sync.prod.js.map',
    'workbox-broadcast-cache-update.dev.js',
    'workbox-broadcast-cache-update.dev.js.map',
    'workbox-broadcast-cache-update.prod.js',
    'workbox-broadcast-cache-update.prod.js.map',
    'workbox-cache-expiration.dev.js',
    'workbox-cache-expiration.dev.js.map',
    'workbox-cache-expiration.prod.js',
    'workbox-cache-expiration.prod.js.map',
    'workbox-cacheable-response.dev.js',
    'workbox-cacheable-response.dev.js.map',
    'workbox-cacheable-response.prod.js',
    'workbox-cacheable-response.prod.js.map',
    'workbox-core.dev.js',
    'workbox-core.dev.js.map',
    'workbox-core.prod.js',
    'workbox-core.prod.js.map',
    'workbox-navigation-preload.dev.js',
    'workbox-navigation-preload.dev.js.map',
    'workbox-navigation-preload.prod.js',
    'workbox-navigation-preload.prod.js.map',
    'workbox-offline-ga.dev.js',
    'workbox-offline-ga.dev.js.map',
    'workbox-offline-ga.prod.js',
    'workbox-offline-ga.prod.js.map',
    'workbox-precaching.dev.js',
    'workbox-precaching.dev.js.map',
    'workbox-precaching.prod.js',
    'workbox-precaching.prod.js.map',
    'workbox-range-requests.dev.js',
    'workbox-range-requests.dev.js.map',
    'workbox-range-requests.prod.js',
    'workbox-range-requests.prod.js.map',
    'workbox-routing.dev.js',
    'workbox-routing.dev.js.map',
    'workbox-routing.prod.js',
    'workbox-routing.prod.js.map',
    'workbox-strategies.dev.js',
    'workbox-strategies.dev.js.map',
    'workbox-strategies.prod.js',
    'workbox-strategies.prod.js.map',
    'workbox-streams.dev.js',
    'workbox-streams.dev.js.map',
    'workbox-streams.prod.js',
    'workbox-streams.prod.js.map',
    'workbox-sw.js',
    'workbox-sw.js.map',
  ];

  describe(`[workbox-webpack-plugin] runtime errors`, function() {
    it(`should throw when swSrc is not set`, function() {
      expect(() => new InjectManifest()).to.throw().with.property('name', 'AssertionError [ERR_ASSERTION]');
    });

    it(`should throw when importWorkboxFrom is set to an invalid chunk name`, function(done) {
      const outputDir = tempy.directory();
      const config = {
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            importWorkboxFrom: 'INVALID',
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run((webpackError) => {
        if (webpackError) {
          if (webpackError.message.includes('importWorkboxFrom')) {
            done();
          } else {
            done(new Error(`An unexpected error was thrown: ${webpackError.message}`));
          }
        } else {
          done(new Error('Unexpected success.'));
        }
      });
    });

    it(`should throw when precacheManifestFilename doesn't include [manifestHash]`, function(done) {
      const outputDir = tempy.directory();
      const config = {
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            precacheManifestFilename: 'will-throw.js',
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run((webpackError) => {
        if (webpackError) {
          if (webpackError.message.includes('precacheManifestFilename')) {
            done();
          } else {
            done(new Error(`An unexpected error was thrown: ${webpackError.message}`));
          }
        } else {
          done(new Error('Unexpected success.'));
        }
      });
    });
  });

  describe(`[workbox-webpack-plugin] Ensure only one precache-manifest is present on re-compile`, function() {
    it(`should only have one reference to precache-manifest file in 'importScripts'`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.b39ca1abe3989f45413fde6b30bf66ce.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            swSrc: SW_SRC,
          }),
        ],
      };
      let emitCount = 0;

      const compiler = webpack(config);
      const watching = compiler.watch({
      }, async (err, stats) => {
        emitCount += 1;

        if (err) {
          done(err);
          return;
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));

        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry2-110d00bd401d8778e907.js',
          }, {
            url: 'entry1-8aeabb1dad51a77ff510.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          if (emitCount == 2) {
            watching.close(done);
          } else {
            watching.invalidate(); // triggers second compilation
          }
        } catch (error) {
          watching.close();
          done(error);
        }
      });
    });
  });

  describe(`[workbox-webpack-plugin] multiple chunks`, function() {
    it(`should work when called with just swSrc`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.b39ca1abe3989f45413fde6b30bf66ce.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry2-110d00bd401d8778e907.js',
          }, {
            url: 'entry1-8aeabb1dad51a77ff510.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should support setting importWorkboxFrom to a chunk's name`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.0ab727619afd560b19a9f5bfd2c50ba7.js';
      const workboxEntryName = 'workboxEntry-acb97be66d4f295c47bd.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          workboxEntry: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            importWorkboxFrom: 'workboxEntry',
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              workboxEntryName,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry2-80c8ec4fa520b837739f.js',
          }, {
            url: 'entry1-65ad51e0418fe6d0d16b.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should support setting importWorkboxFrom to 'local'`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.b39ca1abe3989f45413fde6b30bf66ce.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            importWorkboxFrom: 'local',
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // Validate the copied library files.
          const libraryFiles = glob.sync(`${WORKBOX_DIRECTORY_PREFIX}*/*.js*`,
              {cwd: outputDir});

          const modulePathPrefix = path.dirname(libraryFiles[0]);

          const basenames = libraryFiles.map((file) => path.basename(file));
          expect(basenames).to.eql(ALL_WORKBOX_FILES);

          // The correct importScripts path should use the versioned name of the
          // parent workbox libraries directory. We don't know that version ahead
          // of time, so we ensure that there's a match based on what actually
          // got copied over.
          const workboxSWImport = libraryFiles.filter(
              (file) => file.endsWith('workbox-sw.js'))[0];

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              workboxSWImport,
            ]],
            setConfig: [[{modulePathPrefix}]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry2-110d00bd401d8778e907.js',
          }, {
            url: 'entry1-8aeabb1dad51a77ff510.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should support setting importWorkboxFrom to 'local', and respect output.publicPath`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.1d5056cb0b8c8fc37c01f6cd82de3ee2.js';
      const outputDir = tempy.directory();
      const publicPath = 'https://testing.path/';
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
          publicPath,
        },
        plugins: [
          new InjectManifest({
            importWorkboxFrom: 'local',
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // Validate the copied library files.
          const libraryFiles = glob.sync(`${WORKBOX_DIRECTORY_PREFIX}*/*.js*`,
              {cwd: outputDir});

          const modulePathPrefix = path.dirname(libraryFiles[0]);

          const basenames = libraryFiles.map((file) => path.basename(file));
          expect(basenames).to.eql(ALL_WORKBOX_FILES);

          // The correct importScripts path should use the versioned name of the
          // parent workbox libraries directory. We don't know that version ahead
          // of time, so we ensure that there's a match based on what actually
          // got copied over.
          const workboxSWImport = libraryFiles.filter(
              (file) => file.endsWith('workbox-sw.js'))[0];

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              publicPath + FILE_MANIFEST_NAME,
              publicPath + workboxSWImport,
            ]],
            setConfig: [[{modulePathPrefix: publicPath + modulePathPrefix}]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: publicPath + 'entry2-2a4f7a7a50ef0ba22617.js',
          }, {
            url: publicPath + 'entry1-afdaed1260caa734342e.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should respect output.publicPath if importWorkboxFrom is set to a Webpack chunk name`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.7247bf0bbc5f11658c5a3dfb5bde25b1.js';
      const publicPath = 'https://testing.path/';
      const workboxChunkName = 'workbox-sw-chunk-name';

      const outputDir = tempy.directory();

      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          [workboxChunkName]: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
          publicPath,
        },
        plugins: [
          new InjectManifest({
            importWorkboxFrom: workboxChunkName,
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              publicPath + FILE_MANIFEST_NAME,
              `${publicPath}${workboxChunkName}-521326ec02320821ce1a.js`,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: publicPath + 'entry2-62e5cdd65853608468dd.js',
          }, {
            url: publicPath + 'entry1-b53a11360dd71ca4d75e.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should honor the 'chunks' whitelist config`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.0ab727619afd560b19a9f5bfd2c50ba7.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry3: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            chunks: ['entry1', 'entry2'],
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry2-80c8ec4fa520b837739f.js',
          }, {
            url: 'entry1-65ad51e0418fe6d0d16b.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should honor the 'excludeChunks' blacklist config`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.0ab727619afd560b19a9f5bfd2c50ba7.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry3: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            excludeChunks: ['entry3'],
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry2-80c8ec4fa520b837739f.js',
          }, {
            url: 'entry1-65ad51e0418fe6d0d16b.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should honor setting both the 'chunks' and 'excludeChunks', with the blacklist taking precedence`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.d968dc3de6b4700f035fcfd2f6d9e1c1.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry3: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            chunks: ['entry1', 'entry2'],
            excludeChunks: ['entry2', 'entry3'],
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry1-65ad51e0418fe6d0d16b.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });

  describe(`[workbox-webpack-plugin] html-webpack-plugin and a single chunk`, function() {
    it(`should work when called with just swSrc`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.8d39ec2607aea8245840df761986dad6.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new HtmlWebpackPlugin(),
          new InjectManifest({
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'dbc2f1b29b88e3af1407a7608be20f69',
            url: 'index.html',
          }, {
            url: 'entry2-110d00bd401d8778e907.js',
          }, {
            url: 'entry1-8aeabb1dad51a77ff510.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should honor a custom swDest and publicPath`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.6ac68f5f4c77895e4a29ffe80cfec342.js';
      const SW_DEST = 'custom-sw-dest.js';
      const publicPath = '/testing/';

      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
          publicPath,
        },
        plugins: [
          new HtmlWebpackPlugin(),
          new InjectManifest({
            swDest: SW_DEST,
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, SW_DEST);
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              publicPath + FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'c63f574845712f6fc5d120f9e99505c0',
            url: publicPath + 'index.html',
          }, {
            url: publicPath + 'entry2-06786966b758acc5bba8.js',
          }, {
            url: publicPath + 'entry1-6f947b835686029a65bf.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should support passing options through to workbox-build.getManifest() to precache additional files`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.0b2c45f75a1a30b044067724d5d0d9fb.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
          entry2: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new HtmlWebpackPlugin(),
          new InjectManifest({
            swSrc: SW_SRC,
            globDirectory: SRC_DIR,
            templatedUrls: {
              '/shell': ['index.html', 'styles/*.css'],
            },
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          // There's an expected warning due to the use of globDirectory.
          expect(statsJson.warnings).to.have.lengthOf(1);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'dbc2f1b29b88e3af1407a7608be20f69',
            url: 'index.html',
          }, {
            url: 'entry2-110d00bd401d8778e907.js',
          }, {
            url: 'entry1-8aeabb1dad51a77ff510.js',
          }, {
            revision: '5cfecbd12c9fa32f03eafe27e2ac798e',
            url: '/shell',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });

  describe(`[workbox-webpack-plugin] copy-webpack-plugin and a single chunk`, function() {
    it(`should work when called with just swSrc`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.f6ff560a0d90fc5997e3c6211566cfd7.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        output: {
          filename: WEBPACK_ENTRY_FILENAME,
          path: outputDir,
        },
        plugins: [
          new CopyWebpackPlugin([{
            from: SRC_DIR,
            to: outputDir,
          }]),
          new InjectManifest({
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'a71a1690cf3d141db4ba',
            url: 'webpackEntry.js',
          }, {
            revision: '884f6853a4fc655e4c2dc0c0f27a227c',
            url: 'styles/stylesheet-2.css',
          }, {
            revision: '934823cbc67ccf0d67aa2a2eeb798f12',
            url: 'styles/stylesheet-1.css',
          }, {
            revision: 'a3a71ce0b9b43c459cf58bd37e911b74',
            url: 'page-2.html',
          }, {
            revision: '544658ab25ee8762dc241e8b1c5ed96d',
            url: 'page-1.html',
          }, {
            revision: '3883c45b119c9d7e9ad75a1b4a4672ac',
            url: 'index.html',
          }, {
            revision: '93ffb20d77327583892ca47f597b77aa',
            url: 'images/web-fundamentals-icon192x192.png',
          }, {
            revision: '452b0a9f3978190f4c77997ab23473db',
            url: 'images/example-jpeg.jpg',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });

  describe(`[workbox-webpack-plugin] Filtering via test/include/exclude`, function() {
    it(`should exclude .map and manifest.js files by default`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.6baa7f185013b0f515babaf6ea5f3ec3.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        output: {
          filename: WEBPACK_ENTRY_FILENAME,
          path: outputDir,
        },
        devtool: 'source-map',
        plugins: [
          new CreateWebpackAssetPlugin('manifest.js'),
          new CreateWebpackAssetPlugin('manifest.json'),
          new CreateWebpackAssetPlugin('not-ignored.js'),
          new InjectManifest({
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'a71a1690cf3d141db4ba',
            url: 'webpackEntry.js',
          }, {
            revision: 'aef75af28f6de0771a8d6bae84d9e71d',
            url: 'not-ignored.js',
          }, {
            revision: '4b1eb3dc48c4e16d49db5b42298fe654',
            url: 'manifest.json',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should allow developers to override the default exclude filter`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.88163dc5f160519be44110c2c9d2f0b7.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        output: {
          filename: WEBPACK_ENTRY_FILENAME,
          path: outputDir,
        },
        devtool: 'source-map',
        plugins: [
          new InjectManifest({
            exclude: [],
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'a71a1690cf3d141db4ba',
            url: 'webpackEntry.js.map',
          }, {
            revision: 'a71a1690cf3d141db4ba',
            url: 'webpackEntry.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should allow developers to whitelist via include`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.1242f9e007897f035a52e56690ff17a6.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        output: {
          filename: WEBPACK_ENTRY_FILENAME,
          path: outputDir,
        },
        devtool: 'source-map',
        plugins: [
          new CopyWebpackPlugin([{
            from: SRC_DIR,
            to: outputDir,
          }]),
          new InjectManifest({
            include: [/.html$/],
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'a3a71ce0b9b43c459cf58bd37e911b74',
            url: 'page-2.html',
          }, {
            revision: '544658ab25ee8762dc241e8b1c5ed96d',
            url: 'page-1.html',
          }, {
            revision: '3883c45b119c9d7e9ad75a1b4a4672ac',
            url: 'index.html',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should allow developers to combine the test and exclude filters`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.83df65831eb442f8ad5fbeb8edecc558.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        output: {
          filename: WEBPACK_ENTRY_FILENAME,
          path: outputDir,
        },
        devtool: 'source-map',
        plugins: [
          new CopyWebpackPlugin([{
            from: SRC_DIR,
            to: outputDir,
          }]),
          new InjectManifest({
            swSrc: SW_SRC,
            test: [/.html$/],
            exclude: [/index/],
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, path.basename(SW_SRC));
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'a3a71ce0b9b43c459cf58bd37e911b74',
            url: 'page-2.html',
          }, {
            revision: '544658ab25ee8762dc241e8b1c5ed96d',
            url: 'page-1.html',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });

  describe(`[workbox-webpack-plugin] swDest variations`, function() {
    it(`should work when swDest is an absolute path`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.d47fa1b48905d6942559b5807adc9c79.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        output: {
          filename: WEBPACK_ENTRY_FILENAME,
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            swSrc: SW_SRC,
            // path.resolve() will always return an absolute path.
            swDest: path.resolve(path.join(outputDir, 'service-worker.js')),
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        const swFile = path.join(outputDir, 'service-worker.js');
        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'a71a1690cf3d141db4ba',
            url: 'webpackEntry.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });

  describe(`[workbox-webpack-plugin] Reporting webpack warnings`, function() {
    it(`should add warnings from the workbox-build methods to compilation.warnings`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.d5bf7d4c02fd3a7c0c7a7ea85616aad4.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          // This is not an exhaustive test of all the supported options, but
          // it should be enough to confirm that they're being interpreted
          // by workbox-build.generateSWString() properly.
          new InjectManifest({
            swSrc: SW_SRC,
            globDirectory: SRC_DIR,
            globPatterns: ['**/*'],
            // Make this large enough to cache some, but not all, files.
            maximumFileSizeToCacheInBytes: 20,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(6);

          const swFile = path.join(outputDir, path.basename(SW_SRC));

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'edeab2a4c398a3f25d7b92bedea10d31',
            url: 'webpackEntry.js',
          }, {
            revision: 'a3a71ce0b9b43c459cf58bd37e911b74',
            url: 'page-2.html',
          }, {
            revision: '544658ab25ee8762dc241e8b1c5ed96d',
            url: 'page-1.html',
          }, {
            url: 'entry1-5dac94ada0ec0d6e325c.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should add a warning when various glob-related options are set`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.01a9603fb6b682f58e762e7c56908293.js';
      const outputDir = tempy.directory();
      const globOptionsToWarnAbout = [
        'globDirectory',
        'globFollow',
        'globIgnores',
        'globPatterns',
        'globStrict',
      ];
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            swSrc: SW_SRC,
            globDirectory: SRC_DIR,
            globFollow: true,
            globIgnores: ['ignored'],
            globPatterns: ['**/*.html'],
            globStrict: true,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(1);
          for (const globOptionToWarnAbout of globOptionsToWarnAbout) {
            expect(statsJson.warnings[0]).to.include(globOptionToWarnAbout);
          }

          const swFile = path.join(outputDir, path.basename(SW_SRC));

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            revision: 'a3a71ce0b9b43c459cf58bd37e911b74',
            url: 'page-2.html',
          }, {
            revision: '544658ab25ee8762dc241e8b1c5ed96d',
            url: 'page-1.html',
          }, {
            revision: '3883c45b119c9d7e9ad75a1b4a4672ac',
            url: 'index.html',
          }, {
            url: 'entry1-5dac94ada0ec0d6e325c.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should add a warning when certain options are used, but globPatterns isn't set`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.8e9067f6cf460472279bdcea2b06d22c.js';
      const outputDir = tempy.directory();
      const optionsToWarnAboutWhenGlobPatternsIsNotSet = [
        'dontCacheBustUrlsMatching',
        'manifestTransforms',
        'maximumFileSizeToCacheInBytes',
        'modifyUrlPrefix',
      ];
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            swSrc: SW_SRC,
            dontCacheBustUrlsMatching: /testing/,
            manifestTransforms: [],
            maximumFileSizeToCacheInBytes: 1000000,
            modifyUrlPrefix: {abc: 'def'},
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(1);
          for (const optionToWarnAboutWhenGlobPatternsIsNotSet of optionsToWarnAboutWhenGlobPatternsIsNotSet) {
            expect(statsJson.warnings[0]).to.include(optionToWarnAboutWhenGlobPatternsIsNotSet);
          }

          const swFile = path.join(outputDir, path.basename(SW_SRC));

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({swFile, expectedMethodCalls: {
            importScripts: [[
              FILE_MANIFEST_NAME,
              WORKBOX_SW_FILE_NAME,
            ]],
            suppressWarnings: [[]],
            precacheAndRoute: [[[], {}]],
          }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry1-5dac94ada0ec0d6e325c.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });

  describe(`[workbox-webpack-plugin] Customizing output paths and names`, function() {
    it(`should allow overriding precacheManifestFilename`, function(done) {
      const FILE_MANIFEST_NAME = 'custom-name.8e9067f6cf460472279bdcea2b06d22c.js';
      const outputDir = tempy.directory();
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            precacheManifestFilename: 'custom-name.[manifestHash].js',
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          const swFile = path.join(outputDir, path.basename(SW_SRC));

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({
            swFile, expectedMethodCalls: {
              importScripts: [[
                FILE_MANIFEST_NAME,
                WORKBOX_SW_FILE_NAME,
              ]],
              suppressWarnings: [[]],
              precacheAndRoute: [[[], {}]],
            }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(path.join(outputDir, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry1-5dac94ada0ec0d6e325c.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should allow setting importsDirectory`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.8e9067f6cf460472279bdcea2b06d22c.js';
      const outputDir = tempy.directory();
      const importsDirectory = path.join('one', 'two');
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            importsDirectory,
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          const swFile = path.join(outputDir, path.basename(SW_SRC));

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({
            swFile, expectedMethodCalls: {
              importScripts: [[
                importsDirectory.replace(path.sep, '/') + '/' + FILE_MANIFEST_NAME,
                WORKBOX_SW_FILE_NAME,
              ]],
              suppressWarnings: [[]],
              precacheAndRoute: [[[], {}]],
            }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(
              path.join(outputDir, importsDirectory, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: 'entry1-5dac94ada0ec0d6e325c.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it(`should allow setting importsDirectory, publicPath, and importWorkboxFrom: 'local'`, function(done) {
      const FILE_MANIFEST_NAME = 'precache-manifest.3fa4b0ec2d654242fa39a17bbed207b8.js';
      const outputDir = tempy.directory();
      const importsDirectory = path.join('one', 'two');
      const publicPath = '/testing/';
      const config = {
        mode: 'production',
        entry: {
          entry1: path.join(SRC_DIR, WEBPACK_ENTRY_FILENAME),
        },
        output: {
          publicPath,
          filename: '[name]-[chunkhash].js',
          path: outputDir,
        },
        plugins: [
          new InjectManifest({
            importsDirectory,
            importWorkboxFrom: 'local',
            swSrc: SW_SRC,
          }),
        ],
      };

      const compiler = webpack(config);
      compiler.run(async (webpackError, stats) => {
        if (webpackError) {
          return done(webpackError);
        }

        try {
          const statsJson = stats.toJson('verbose');
          expect(statsJson.warnings).to.have.lengthOf(0);

          const swFile = path.join(outputDir, path.basename(SW_SRC));

          // Validate the copied library files.
          const libraryFiles = glob.sync(`${WORKBOX_DIRECTORY_PREFIX}*/*.js*`,
              {cwd: path.join(outputDir, importsDirectory)});

          const modulePathPrefix = path.dirname(libraryFiles[0]);

          const basenames = libraryFiles.map((file) => path.basename(file));
          expect(basenames).to.eql(ALL_WORKBOX_FILES);

          // The correct importScripts path should use the versioned name of the
          // parent workbox libraries directory. We don't know that version ahead
          // of time, so we ensure that there's a match based on what actually
          // got copied over.
          const workboxSWImport = libraryFiles.filter(
              (file) => file.endsWith('workbox-sw.js'))[0];

          // First, validate that the generated service-worker.js meets some basic assumptions.
          await validateServiceWorkerRuntime({
            swFile, expectedMethodCalls: {
              importScripts: [[
                publicPath + importsDirectory.replace(path.sep, '/') + '/' + FILE_MANIFEST_NAME,
                publicPath + importsDirectory.replace(path.sep, '/') + '/' + workboxSWImport,
              ]],
              setConfig: [[{modulePathPrefix: publicPath + importsDirectory.replace(path.sep, '/') + '/' + modulePathPrefix}]],
              suppressWarnings: [[]],
              precacheAndRoute: [[[], {}]],
            }});

          // Next, test the generated manifest to ensure that it contains
          // exactly the entries that we expect.
          const manifestFileContents = await fse.readFile(
              path.join(outputDir, importsDirectory, FILE_MANIFEST_NAME), 'utf-8');
          const context = {self: {}};
          vm.runInNewContext(manifestFileContents, context);

          const expectedEntries = [{
            url: publicPath + 'entry1-5849069f3e4ba95218db.js',
          }];
          expect(context.self.__precacheManifest).to.eql(expectedEntries);

          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });
});
