// !! NOT WORKING, AS STEAM IS USING OPENID 2.0 INSTEAD OF OPENID CONNECT !!

import express from 'express';
import session from 'express-session';
import passport from 'passport';
import dotenv from 'dotenv';
import SteamStrategy from 'passport-steam';

dotenv.config();

const STEAM_API_KEY = process.env.STEAM_API_KEY;
if (!STEAM_API_KEY) {
  throw new Error('STEAM_API_KEY is not set in environment variables');
}
const PORT = 3000;

passport.serializeUser((user: any, done) => done(null, user));
passport.deserializeUser((obj: any, done) => done(null, obj));

passport.use(new SteamStrategy(
  {
    returnURL: `http://localhost:${PORT}/auth/steam/return`,
    realm: `http://localhost:${PORT}/`,
    apiKey: STEAM_API_KEY,
  },
  function (identifier, profile, done) {
    // profile.id is the SteamID
    return done(null, profile);
  }
));

const app = express();

app.use((req, res, next) => {
  console.log(req.method, req.url, req.session);
  next();
});

app.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

app.get('/auth/steam', passport.authenticate('steam'));

app.get(
  '/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => {
    // @ts-ignore
    const steamId = req.user?.id;
    console.log('Logged in SteamID:', steamId);
    res.send(`Logged in! SteamID: ${steamId}`);
  }
);

app.get('/', (req, res) => {
  res.send('Steam Login Demo. Go to <a href="/auth/steam">/auth/steam</a> to login with Steam.');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log('Visit /auth/steam to login with Steam');
});
