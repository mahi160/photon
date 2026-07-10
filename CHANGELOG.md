# [1.5.0](https://github.com/mahi160/photon/compare/v1.4.1...v1.5.0) (2026-07-10)


### Features

* **updater:** surface error messages instead of silently failing ([b79b451](https://github.com/mahi160/photon/commit/b79b4511ba84a0c59d954f24af31b68e4a6a155c))

## [1.4.1](https://github.com/mahi160/photon/compare/v1.4.0...v1.4.1) (2026-07-10)


### Bug Fixes

* **jellyfin:** validate auth response and improve error messages ([6cef70e](https://github.com/mahi160/photon/commit/6cef70e8d240e8f484a76cc81636b0eef759fe1a))

# [1.4.0](https://github.com/mahi160/photon/compare/v1.3.0...v1.4.0) (2026-07-10)


### Bug Fixes

* **api:** add request timeout and dynamic app version header ([7b983f7](https://github.com/mahi160/photon/commit/7b983f73417a24773d7a3816949ab3aeee50c889))


### Features

* **app:** wire router error handler and pass app version to API ([c26648d](https://github.com/mahi160/photon/commit/c26648d84ffcf8cc17262c86bfc69c49ea714370))
* **ui:** add route error and 404 fallback pages ([c327487](https://github.com/mahi160/photon/commit/c327487e76311016af59356bba2b11e6feba3e69))

# [1.3.0](https://github.com/mahi160/photon/compare/v1.2.1...v1.3.0) (2026-07-09)


### Features

* **main:** broadcast updater status to renderer on state changes ([7057049](https://github.com/mahi160/photon/commit/7057049168c94f2e5f891b7cbfc38ca70468046f))
* **preload:** add updater status API and event listener ([c76514a](https://github.com/mahi160/photon/commit/c76514a9a81fe5b5d4513ffb133b955656c2123a))
* **ui/login:** add panel container and enhance field styling ([ae5339b](https://github.com/mahi160/photon/commit/ae5339b8ff3d7aff36e8e45f26c38c99f34b5be5))
* **ui/settings:** show updater status and restart-to-update button ([573b693](https://github.com/mahi160/photon/commit/573b693a4a685cd1d127592396f9e28121047407))

## [1.2.1](https://github.com/mahi160/photon/compare/v1.2.0...v1.2.1) (2026-07-09)


### Bug Fixes

* **build:** unbreak launch on macOS and Windows ([a7a27ee](https://github.com/mahi160/photon/commit/a7a27eed231eb9a243f13241853d555167911f6d))

# [1.2.0](https://github.com/mahi160/photon/compare/v1.1.0...v1.2.0) (2026-07-09)


### Features

* **release:** automate releases with semantic-release + commitlint ([5bde74b](https://github.com/mahi160/photon/commit/5bde74b187189ca01c9b9b19d4ca1738e2719202))
* **ui:** migrate to reicon icons, add PhotonMark component ([bfafac3](https://github.com/mahi160/photon/commit/bfafac379ce4b56b72b09db8db9310e1324b1025))


### Performance Improvements

* memoize playback menus and stabilize callback identities ([657f872](https://github.com/mahi160/photon/commit/657f872ddee6ca99a5639f5dd382c0cba09a8c19))
