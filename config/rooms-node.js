// Node requires JSON import attributes. Pages' managed bundler selects the
// package's default JSON import directly and never includes this Node adapter.
import rooms from './rooms.json' with { type: 'json' };
export default rooms;
