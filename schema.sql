CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, show TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS jokes (
  id INTEGER PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  t INTEGER NOT NULL,
  mangled_ar TEXT NOT NULL,
  mangled_latin TEXT NOT NULL,
  meant TEXT NOT NULL,
  meant_ar TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  aliases TEXT NOT NULL,
  skeletons TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS jokes_fts USING fts5(
  skeletons, aliases, meant, summary, mangled_ar,
  content='jokes', content_rowid='id', tokenize='trigram');
