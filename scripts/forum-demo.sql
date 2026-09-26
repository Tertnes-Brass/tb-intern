-- KUN lokal demodatabase. Opprett Ingrid og Jonas via /api/dev-login først.
-- Faste ID-er gjør at skriptet kan kjøres flere ganger uten duplikater.
INSERT OR IGNORE INTO forum_topics (id, author_id, title, body, locked, created_at, updated_at, activity_at)
SELECT 'demo-forum-fest', id, 'Hvem blir med på fest?',
'Har dere lyst til å møtes etter øvelsen på fredag? Vi kan bestille pizza og ta en sosial kveld sammen. Svar gjerne med om du blir med!',
0, 1790438400000, 1790438400000, 1790440200000
FROM user WHERE email = 'ingrid@demo.tertnesbrass.no';

INSERT OR IGNORE INTO forum_replies (id, topic_id, author_id, body, created_at, updated_at)
SELECT 'demo-forum-fest-jonas', 'demo-forum-fest', id,
'Jeg blir med! Skal jeg ta med noe å drikke?', 1790439300000, 1790439300000
FROM user WHERE email = 'jonas@demo.tertnesbrass.no'
AND EXISTS (SELECT 1 FROM forum_topics WHERE id = 'demo-forum-fest');

INSERT OR IGNORE INTO forum_replies (id, topic_id, author_id, body, created_at, updated_at)
SELECT 'demo-forum-fest-ingrid', 'demo-forum-fest', id,
'Ja, gjerne! Jeg ordner pizza. Flere som blir med?', 1790440200000, 1790440200000
FROM user WHERE email = 'ingrid@demo.tertnesbrass.no'
AND EXISTS (SELECT 1 FROM forum_topics WHERE id = 'demo-forum-fest');
