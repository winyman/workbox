importScripts('/__WORKBOX/buildFile/workbox-sw');

// TODO: Find some way to autogenerate this list.
const namespaces = [
  'backgroundSync',
  'broadcastUpdate',
  'cacheableResponse',
  'core',
  'expiration',
  'googleAnalytics',
  'precaching',
  'rangeRequests',
  'routing',
  'strategies',
];

for (const namespace of namespaces) {
  const module = self.workbox[namespace];
  if (!module) {
    throw new Error(`$self.workbox.{namespace} did not load the expected interface.`);
  }
}
