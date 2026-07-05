# Hybrid search: local index for movies/shows, server search for episodes

Photon promises search latency under 100ms, which a network round trip to a home Jellyfin server cannot guarantee. We fetch a lightweight index of all movies and shows (id, title, year) once per launch and fuzzy-filter it locally; episodes are searched server-side (debounced) because large servers hold 100k+ episodes and indexing them locally would blow startup time and memory. The visible consequence is two search paths in code: movie/show results are instant, episode results stream in after.
