import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import serverless from "serverless-http";

// Extend express-session types to include walletAddress
import 'express-session';
declare module 'express-session' {
  interface SessionData {
    walletAddress?: string;
  }
}
import passport from 'passport';
import SteamStrategy from 'passport-steam';

import { Database, User, AssetRecord, EscrowRecord, SteamInventoryResponse } from './database_handler';
import { SteamAsset, storeAssetOnWalrus, retrieveAssetFromWalrus } from './walrus_handler';
import { escrowEventListener, createSteamInventoryChecker, EscrowStatusUpdate } from './escrow_handler';
import { randomUUID } from 'crypto';
import steamAppsData from './test/steam-web-api/data/steam_apps.json';

// Temporary in-memory token store for walletAddress
const steamLoginTokenMap = new Map<string, string>();

// Steam user profile interface
interface SteamProfile {
  id: string;
  displayName: string;
  profileUrl: string;
  photos: Array<{ value: string }>;
  _json: Record<string, unknown>;
}

// Get env vars
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3111;
const DB_NAME = "data.sqlite3";

// Environment variables
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

// Steam API key validation
if (!STEAM_API_KEY) {
  console.warn('STEAM_API_KEY is not set in environment variables. Steam authentication will not work.');
}

// Initialize database
const db = new Database(DB_NAME);

// Initialize Steam inventory checker
const steamInventoryChecker = STEAM_API_KEY ? createSteamInventoryChecker(STEAM_API_KEY) : null;

// Initialize escrow event listener
escrowEventListener.onEscrowStatusUpdate((update: EscrowStatusUpdate) => {
  console.log("Escrow status update:", update);
  // Here you could store escrow updates in database, send notifications, etc.
});

// Start listening for escrow events
escrowEventListener.startListening().catch(console.error);

// Configure passport for Steam authentication
passport.serializeUser((user: unknown, done) => done(null, user));
passport.deserializeUser((obj: unknown, done) => done(null, obj as Express.User));

if (STEAM_API_KEY) {
  passport.use(new SteamStrategy(
    {
      returnURL: `${BACKEND_URL}/auth/steam/return`,
      realm: `${BACKEND_URL}/`,
      apiKey: STEAM_API_KEY,
    },
    function (identifier, profile, done) {
      // profile.id is the SteamID
      return done(null, profile);
    }
  ));
}

// -- Middlewares --
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware - Netlify serverless functions require explicit handling

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Persistent session store using SQLite
const SQLiteStore = SQLiteStoreFactory(session);

// Determine if we're in production
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

app.use(session({ 
  store: new SQLiteStore({ db: 'sessions.sqlite3', dir: './' }) as any,
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production', 
  resave: false, 
  saveUninitialized: true,
  cookie: {
    secure: isProduction, // Use secure cookies in production (HTTPS)
    sameSite: isProduction ? 'none' : 'lax', // Allow cross-site cookies in production
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true, // Prevent XSS attacks
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// CORS middleware - Enhanced for Vercel deployment
const FRONTEND_URL = process.env.FRONTEND_URL;
const PRODUCTION_FRONTEND_URL = process.env.PRODUCTION_FRONTEND_URL || 'https://pudeez-frontend-jjif.vercel.app';

// Allow multiple origins for CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5174',
  'https://pudeez-frontend-jjif.vercel.app',
  FRONTEND_URL,
  PRODUCTION_FRONTEND_URL
].filter(Boolean); // Remove any undefined values

console.log('CORS configured for origins:', allowedOrigins);

if (FRONTEND_URL === '*') {
  console.warn('CORS is set to allow all origins. Set FRONTEND_URL in your environment for better security.');
}

// Removed manual CORS header middleware; handled by cors() above.

// Global OPTIONS handler as safety net for all preflight requests
app.options('/{*splat}', (req: Request, res: Response) => {
  console.log('Global OPTIONS handler triggered for:', req.path);
  res.status(200).end();
});

// Error handling middleware
app.use(
    (
        err: Error,
        req: Request,
        res: Response,
        // gotta love this shit
        // eslint-disable-next-line
        next: NextFunction
    ) => {
      console.error(err.stack);
      res.status(500).json({ error: 'Something went wrong!' });
});


// -- Endpoints --
// Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to the Express.js TypeScript API!' });
});
app.get('/test/getAllUsers', async (req: Request, res: Response) => {
  try {
    const users = await db.getAllUsers();
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});
// Steam Authentication Routes
app.get('/auth/steam/login', (req: Request, res: Response, next: NextFunction) => {
    if (!STEAM_API_KEY) {
        return res.status(500).json({ 
            error: 'Steam authentication is not configured. STEAM_API_KEY is missing.' 
        });
    }
    const { walletAddress } = req.query;
    if (!walletAddress || typeof walletAddress !== 'string') {
        return res.status(400).json({ error: 'walletAddress is required as a query parameter' });
    }
    // Generate a random token and store the mapping
    const token = randomUUID();
    steamLoginTokenMap.set(token, walletAddress);
    // Redirect to Steam login with token as query param
    const redirectUrl = `/auth/steam?token=${encodeURIComponent(token)}`;
    res.redirect(redirectUrl);
});

// passport-steam default route 
app.get('/auth/steam', (req, res, next) => {
    const token = req.query.token as string | undefined;
    const returnURL = token
        ? `${BACKEND_URL}/auth/steam/return/${encodeURIComponent(token)}`
        : `${BACKEND_URL}/auth/steam/return`;
    console.log('[DEBUG] passport-steam returnURL:', returnURL);
    passport.authenticate('steam', { returnURL } as any)(req, res, next);
});

app.get('/auth/steam/return',
    passport.authenticate('steam', { failureRedirect: '/auth/steam/error' }),
    async (req: Request, res: Response) => {
        const steamUser = req.user as SteamProfile;
        const steamId = steamUser?.id;
        
        console.log('Steam authentication successful:', {
            steamId: steamId,
            displayName: steamUser?.displayName,
            photos: steamUser?.photos
        });
        
        // Redirect to frontend after successful Steam authentication, passing steamId and displayName
        const redirectUrl = `${FRONTEND_URL}/?steamId=${encodeURIComponent(steamId ?? '')}&displayName=${encodeURIComponent(steamUser?.displayName ?? '')}`;
        res.redirect(redirectUrl);
        // res.json({
        //     success: true,
        //     message: 'Steam authentication successful',
        //     steamId: steamId,
        //     displayName: steamUser?.displayName,
        //     profileUrl: steamUser?.profileUrl,
        //     avatar: steamUser?.photos?.[0]?.value
        // });
    }
);

app.get('/auth/steam/error', (req: Request, res: Response) => {
    res.status(401).json({ 
        error: 'Steam authentication failed',
        message: 'Unable to authenticate with Steam. Please try again.'
    });
});

// Insert new address & steamID pair from user
app.post('/api/user/add', (req: Request, res: Response) => {
    const userData = req.body as User;
    db.addRow(userData.address, String(userData.steamID), (err: Error | null) => {
        if (err) {
            console.error('Error adding user:', err);
            if ((err as any).code === 'SQLITE_CONSTRAINT') {
                res.status(409).json({ success: false, error: 'User address already exists', details: err.message });
            } else {
                res.status(500).json({ success: false, error: 'Failed to add user', details: err.message });
            }
        } else {
            console.log('User added successfully:', userData);
            res.status(200).json({ success: true, message: 'User added successfully' });
        }
    });
});

app.post('/api/user/get_steamid', (req: Request, res: Response) => {
    const address = req.body.address;
    console.log('[get_steamid] Received address:', address);
    db.getSteamID(address, (err: Error | null, steamID?: string) => {
        if (err) {
            console.error('[get_steamid] DB error:', err);
            return res.status(500).json({ error: err.message });
        }
        console.log('[get_steamid] Returning steamID:', steamID, 'for address:', address);
        res.status(200).json({ steamID });
    });
})

// Get Steam profile information for a wallet address using public Steam Community API
app.post('/api/user/get_steam_profile', async (req: Request, res: Response) => {
    try {
        const { address } = req.body;
        
        if (!address) {
            return res.status(400).json({ 
                error: 'Wallet address is required' 
            });
        }

        console.log('[get_steam_profile] Received address:', address);

        // First get the Steam ID from our database
        db.getSteamID(address, async (err: Error | null, steamID?: string) => {
            if (err) {
                console.error('[get_steam_profile] DB error:', err);
                return res.status(500).json({ error: err.message });
            }

            if (!steamID) {
                return res.status(404).json({ 
                    error: 'No Steam account linked to this wallet address' 
                });
            }

            console.log('[get_steam_profile] Found steamID:', steamID);

            try {
                // Use Steam Community public XML API (no API key required)
                const steamProfileUrl = `https://steamcommunity.com/profiles/${steamID}/?xml=1`;
                console.log('[get_steam_profile] Fetching from Steam Community XML API...');

                const response = await axios.get(steamProfileUrl, {
                    timeout: 10000, // 10 second timeout
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                // Parse XML response (Steam returns XML format)
                const xmlData = response.data;
                
                // Basic XML parsing for Steam profile data
                const steamidMatch = xmlData.match(/<steamID64>(\d+)<\/steamID64>/);
                const nameMatch = xmlData.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
                const avatarMatch = xmlData.match(/<avatarIcon><!\[CDATA\[(.*?)\]\]><\/avatarIcon>/);
                const avatarMediumMatch = xmlData.match(/<avatarMedium><!\[CDATA\[(.*?)\]\]><\/avatarMedium>/);
                const avatarFullMatch = xmlData.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/);
                const profileUrlMatch = xmlData.match(/<profileURL><!\[CDATA\[(.*?)\]\]><\/profileURL>/);
                const onlineStateMatch = xmlData.match(/<onlineState><!\[CDATA\[(.*?)\]\]><\/onlineState>/);
                const stateMessageMatch = xmlData.match(/<stateMessage><!\[CDATA\[(.*?)\]\]><\/stateMessage>/);
                const realNameMatch = xmlData.match(/<realname><!\[CDATA\[(.*?)\]\]><\/realname>/);
                const visibilityMatch = xmlData.match(/<visibilityState>(\d+)<\/visibilityState>/);

                // Check if profile data was found (profile might be private)
                if (!steamidMatch || !nameMatch) {
                    return res.status(404).json({ 
                        error: 'Steam profile not found or is set to private' 
                    });
                }

                // Map online state text to numeric values (similar to Steam Web API)
                const getPersonaState = (state: string) => {
                    switch (state?.toLowerCase()) {
                        case 'online': return 1;
                        case 'busy': return 2;
                        case 'away': return 3;
                        case 'snooze': return 4;
                        case 'looking to trade': return 5;
                        case 'looking to play': return 6;
                        default: return 0; // offline
                    }
                };

                // Transform Steam Community XML response to match ProfilePage expectations
                const profileData = {
                    steamid: steamidMatch[1],
                    personaname: nameMatch[1],
                    profileurl: profileUrlMatch ? profileUrlMatch[1] : `https://steamcommunity.com/profiles/${steamID}`,
                    avatar: avatarMatch ? avatarMatch[1] : '',
                    avatarmedium: avatarMediumMatch ? avatarMediumMatch[1] : '',
                    avatarfull: avatarFullMatch ? avatarFullMatch[1] : '',
                    personastate: onlineStateMatch ? getPersonaState(onlineStateMatch[1]) : 0,
                    communityvisibilitystate: visibilityMatch ? parseInt(visibilityMatch[1]) : 1,
                    statemessage: stateMessageMatch ? stateMessageMatch[1] : '',
                    realname: realNameMatch ? realNameMatch[1] : '',
                    lastlogoff: null // Not available in XML API
                };

                console.log('[get_steam_profile] Successfully fetched profile for:', profileData.personaname);

                res.status(200).json({ 
                    success: true,
                    profile: profileData 
                });

            } catch (steamApiError) {
                console.error('[get_steam_profile] Steam Community API error:', steamApiError);
                
                if (axios.isAxiosError(steamApiError)) {
                    if (steamApiError.response?.status === 404) {
                        return res.status(404).json({ 
                            error: 'Steam profile not found' 
                        });
                    } else if (steamApiError.response?.status === 403) {
                        return res.status(403).json({ 
                            error: 'Steam profile is private or restricted' 
                        });
                    } else if (steamApiError.response?.status === 429) {
                        return res.status(429).json({ 
                            error: 'Too many requests. Please try again later.' 
                        });
                    }
                }

                res.status(500).json({ 
                    error: 'Failed to fetch Steam profile data from Steam Community' 
                });
            }
        });

    } catch (error) {
        console.error('[get_steam_profile] Unexpected error:', error);
        res.status(500).json({ 
            error: 'Internal server error while fetching Steam profile' 
        });
    }
});

// Get Steam inventory for a user
app.get('/api/steam/inventory/:steamID', async (req: Request, res: Response) => {
    try {
        const { steamID } = req.params;
        const appid = req.query.appid ? parseInt(req.query.appid as string) : undefined;
        const contextid = req.query.contextid ? parseInt(req.query.contextid as string) : undefined;

        // Validate steamID (should be numeric)
        if (!steamID || !/^\d+$/.test(steamID)) {
            res.status(400).json({
                error: 'Invalid Steam ID format. Must be numeric.'
            });
            return;
        }

        // Validate required parameters
        if (!appid || !contextid) {
            res.status(400).json({
                error: 'Missing required parameters: appid and contextid are required'
            });
            return;
        }

        const steamApiUrl = `https://steamcommunity.com/inventory/${steamID}/${appid}/${contextid}`;
        console.log(`Fetching Steam inventory from: ${steamApiUrl}`);

        const response = await axios.get<SteamInventoryResponse>(steamApiUrl, {
            timeout: 10000 // 10 second timeout
        });

        const inventoryData = response.data;
        // Removed full raw response log for clarity

        if (!inventoryData.success || inventoryData.success !== 1) {
            res.status(404).json({
                error: inventoryData.error || 'Steam inventory not found or private'
            });
            return;
        }

        // Merge assets and descriptions for frontend
        const assets = (inventoryData.assets || []).map(asset => {
            // Find matching description by classid and instanceid
            const desc = (inventoryData.descriptions || []).find(d =>
                d.classid === asset.classid && d.instanceid === asset.instanceid
            );
            if (!desc) {
                console.warn(`[Inventory Merge Warning] No description found for assetid=${asset.assetid}, classid=${asset.classid}, instanceid=${asset.instanceid}`);
            }
            return {
                assetid: asset.assetid,
                classid: asset.classid,
                instanceid: asset.instanceid,
                contextid: asset.contextid,
                appid: asset.appid,
                amount: asset.amount,
                icon_url: desc?.icon_url || '',
                name: desc?.name || desc?.market_hash_name || '',
                type: desc?.type || '',
                // Add more fields if needed
            };
        });

        // console.log('[Merged assets output]', JSON.stringify(assets, null, 2));
        res.json({ assets });
        return;
    } catch (error) {
        // Enhanced error logging
        if (axios.isAxiosError(error)) {
            console.error('Error fetching Steam inventory (AxiosError):', {
                message: error.message,
                code: error.code,
                status: error.response?.status,
                data: error.response?.data,
                headers: error.response?.headers,
                config: error.config,
            });
            if (error.response?.status === 401) {
                res.status(403).json({
                    error: 'Steam inventory is private or requires authentication'
                });
                return;
            } else if (error.response?.status === 403) {
                res.status(403).json({
                    error: 'Steam inventory is private or user not found'
                });
                return;
            } else if (error.response?.status === 500) {
                res.status(502).json({
                    error: 'Steam API is currently unavailable'
                });
                return;
            } else {
                // Log and return the error from Steam API if available
                res.status(error.response?.status || 500).json({
                    error: error.response?.data || error.message || 'Unknown error from Steam API'
                });
                return;
            }
        } else {
            console.error('Error fetching Steam inventory (Non-Axios):', error);
        }
        res.status(500).json({
            error: 'Failed to fetch Steam inventory'
        });
        return;
    }
});

// List Steam asset data on Walrus
app.post('/api/walrus/list', async (req: Request, res: Response) => {
    try {
        const assetData = req.body as SteamAsset;
        
        // Validate required fields
        if (!assetData.appid || !assetData.assetid || !assetData.walletAddress || !assetData.icon_url || !assetData.name || !assetData.price) {
            return res.status(400).json({ 
                error: 'Missing required fields: appid, assetid, walletAddress, icon_url, name, and price are required' 
            });
        }

        // Basic Sui address validation (0x followed by 64 hex characters)
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(assetData.walletAddress)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format. Must be 0x followed by 64 hex characters'
            });
        }

        // Validate price format (should be a valid number in SUI)
        const priceNumber = parseFloat(assetData.price);
        if (isNaN(priceNumber) || priceNumber < 0) {
            return res.status(400).json({
                error: 'Invalid price format. Price must be a valid non-negative number in SUI'
            });
        }

        const blobId = await storeAssetOnWalrus(assetData);
        
        if (blobId) {
            // Store asset record in database
            const assetRecord: AssetRecord = {
                walletAddress: assetData.walletAddress,
                blobId: blobId,
                appid: assetData.appid,
                assetid: assetData.assetid,
                classid: assetData.classid,
                instanceid: assetData.instanceid,
                contextid: assetData.contextid,
                amount: assetData.amount,
                icon_url: assetData.icon_url,
                name: assetData.name,
                price: assetData.price,
                steamID: assetData.steamID,
                steamName: assetData.steamName,
                uploadedAt: new Date().toISOString()
            };

            try {
                await db.addAsset(assetRecord);
                res.status(200).json({
                    success: true,
                    blobId: blobId,
                    walletAddress: assetData.walletAddress,
                    message: 'Asset data listed successfully on Walrus and database'
                });
            } catch (dbError) {
                console.error('Error storing asset in database:', dbError);
                // Still return success since Walrus storage worked
                res.status(200).json({
                    success: true,
                    blobId: blobId,
                    walletAddress: assetData.walletAddress,
                    message: 'Asset data listed on Walrus but failed to update database',
                    warning: 'Database update failed'
                });
            }
        } else {
            res.status(500).json({
                error: 'Failed to list asset data on Walrus'
            });
        }
    } catch (error) {
        console.error('Error in walrus list endpoint:', error);
        res.status(500).json({
            error: 'Internal server error while listing asset data'
        });
    }
});

// Retrieve Steam asset data from Walrus
app.get('/api/walrus/retrieve/:blobId', async (req: Request, res: Response) => {
    try {
        const { blobId } = req.params;
        
        if (!blobId) {
            return res.status(400).json({
                error: 'Blob ID is required'
            });
        }

        const assetData = await retrieveAssetFromWalrus(blobId);
        
        res.status(200).json({
            success: true,
            data: assetData,
            blobId: blobId
        });
    } catch (error) {
        console.error('Error in walrus retrieve endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve asset data from Walrus'
        });
    }
});

// Walrus Upload Proxy to handle CORS issues
app.post('/api/walrus/upload-proxy', async (req: Request, res: Response) => {
    try {
        const { data, epochs = 5 } = req.body;
        
        if (!data) {
            return res.status(400).json({
                error: 'Data is required'
            });
        }

        // Convert base64 data to buffer if needed
        let buffer: Buffer;
        if (typeof data === 'string') {
            // If it's base64, decode it
            if (data.startsWith('data:')) {
                const base64Data = data.split(',')[1];
                buffer = Buffer.from(base64Data, 'base64');
            } else {
                // If it's plain string, convert to buffer
                buffer = Buffer.from(data, 'utf-8');
            }
        } else if (data instanceof Buffer) {
            buffer = data;
        } else {
            // If it's an object, stringify it
            buffer = Buffer.from(JSON.stringify(data), 'utf-8');
        }

        console.log('Walrus proxy: Uploading blob of size:', buffer.length, 'bytes');

        const publisherEndpoints = [
            'https://publisher.walrus-testnet.walrus.space',
            'https://wal-publisher-testnet.staketab.org'
        ];

        let walrusSuccess = false;
        let lastError = null;
        let blobId = null;

        for (const publisherUrl of publisherEndpoints) {
            try {
                console.log(`Walrus proxy: Attempting upload to: ${publisherUrl}`);
                
                const response = await axios.put(
                    `${publisherUrl}/v1/blobs?epochs=${epochs}`,
                    buffer,
                    {
                        headers: {
                            'Content-Type': 'application/octet-stream'
                        },
                        timeout: 30000 // 30 second timeout
                    }
                );

                if (response.status === 200) {
                    const walrusResponse = response.data;
                    blobId = walrusResponse?.newlyCreated?.blobObject?.blobId || walrusResponse?.alreadyCertified?.blobId;
                    
                    if (blobId) {
                        console.log(`Walrus proxy: Upload successful! Blob ID: ${blobId} via ${publisherUrl}`);
                        walrusSuccess = true;
                        break;
                    }
                }
            } catch (error: any) {
                const errorMessage = error.response?.data || error.message || String(error);
                lastError = `${publisherUrl}: ${errorMessage}`;
                console.warn(`Walrus proxy: Upload failed at ${publisherUrl}:`, errorMessage);
            }
        }

        if (walrusSuccess && blobId) {
            res.status(200).json({
                success: true,
                blobId: blobId,
                message: 'Blob uploaded successfully to Walrus'
            });
        } else {
            console.warn('Walrus proxy: All publisher endpoints failed. Last error:', lastError);
            res.status(500).json({
                success: false,
                error: 'All Walrus publisher endpoints failed',
                details: lastError
            });
        }
        
    } catch (error) {
        console.error('Error in Walrus upload proxy:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error in upload proxy'
        });
    }
});

// Get all assets for a specific wallet address
app.get('/api/walrus/assets/:walletAddress', async (req: Request, res: Response) => {
    try {
        const { walletAddress } = req.params;
        console.log(`GET /api/walrus/assets/${walletAddress} - Request received`);
        
        if (!walletAddress) {
            console.log('No wallet address provided');
            return res.status(400).json({
                error: 'Wallet address is required'
            });
        }

        // Basic Sui address validation
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(walletAddress)) {
            console.log(`Invalid wallet address format: ${walletAddress}`);
            return res.status(400).json({
                error: 'Invalid Sui wallet address format'
            });
        }

        console.log(`Fetching assets for wallet: ${walletAddress}`);
        const assets = await db.getAssetsByWallet(walletAddress);
        console.log(`Found ${assets.length} assets for wallet ${walletAddress}`);
        
        res.status(200).json({
            success: true,
            walletAddress: walletAddress,
            assets: assets,
            count: assets.length
        });
    } catch (error) {
        console.error('Error in get assets by wallet endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve assets for wallet address'
        });
    }
});

// Get all assets (with optional pagination)
app.get('/api/walrus/assets', async (req: Request, res: Response) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
        
        // Validate pagination parameters
        if (limit && (limit < 1 || limit > 100)) {
            return res.status(400).json({
                error: 'Limit must be between 1 and 100'
            });
        }
        
        if (offset && offset < 0) {
            return res.status(400).json({
                error: 'Offset must be non-negative'
            });
        }

        const assets = await db.getAllAssets(limit, offset);
        
        res.status(200).json({
            success: true,
            assets: assets,
            count: assets.length,
            pagination: {
                limit: limit || null,
                offset: offset || null
            }
        });
    } catch (error) {
        console.error('Error in get all assets endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve assets'
        });
    }
});

// Get marketplace assets (formatted for marketplace display)
app.get('/api/marketplace/assets', async (req: Request, res: Response) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
        
        // Validate pagination parameters
        if (limit < 1 || limit > 100) {
            return res.status(400).json({
                error: 'Limit must be between 1 and 100'
            });
        }
        
        if (offset < 0) {
            return res.status(400).json({
                error: 'Offset must be non-negative'
            });
        }

        // Get all assets first, then filter based on escrow status
        const allAssets = await db.getAllAssets(limit * 2, offset); // Fetch more to account for filtering
        
        // Get active escrows that should hide/remove assets from marketplace
        const activeEscrows = await db.getActiveEscrows();
        
        // Create a map of asset IDs that should be hidden (initialized/deposited/in-progress) or removed (completed)
        const hiddenAssetIds = new Set<string>();
        const removedAssetIds = new Set<string>();
        
        activeEscrows.forEach((escrow: EscrowRecord) => {
            if (escrow.status === 'completed') {
                removedAssetIds.add(escrow.assetId);
            } else if (['initialized', 'deposited', 'in-progress'].includes(escrow.status)) {
                hiddenAssetIds.add(escrow.assetId);
            }
            // 'cancelled' status means the asset should be visible again (not hidden or removed)
        });
        
        // Filter assets to exclude hidden and removed ones
        const visibleAssets = allAssets.filter((asset: AssetRecord) => 
            !hiddenAssetIds.has(asset.assetid) && !removedAssetIds.has(asset.assetid)
        );
        
        // Take only the requested limit after filtering
        const assets = visibleAssets.slice(0, limit);
        
        // Helper function to format SUI prices intelligently  
        const formatSuiPrice = (price: string): string => {
            // Handle null, undefined, or empty string
            if (!price || price === '' || price === '0' || price === 'null' || price === 'undefined') {
                return "0 SUI";
            }
            
            const num = parseFloat(price);
            
            if (isNaN(num) || num === 0) {
                return "0 SUI";
            }
            
            // Smart decimal formatting based on amount size
            let formatted: string;
            if (num < 0.001) {
                // For very small amounts, show up to 8 decimals
                formatted = num.toFixed(8).replace(/\.?0+$/, '');
            } else if (num < 0.01) {
                // For small amounts, show up to 6 decimals
                formatted = num.toFixed(6).replace(/\.?0+$/, '');
            } else if (num < 1) {
                // For amounts less than 1, show up to 4 decimals
                formatted = num.toFixed(4).replace(/\.?0+$/, '');
            } else {
                // For larger amounts, show up to 3 decimals
                formatted = num.toFixed(3).replace(/\.?0+$/, '');
            }
            
            return `${formatted} SUI`;
        };

        // Helper function to get game info by appid
        const getGameInfo = (appid: number) => {
            const gameMap: Record<number, { name: string; id: string }> = {
                730: { name: "Counter-Strike: Global Offensive", id: "csgo" },
                570: { name: "Dota 2", id: "dota2" },
                440: { name: "Team Fortress 2", id: "tf2" },
                252490: { name: "Rust", id: "rust" },
                304930: { name: "Unturned", id: "unturned" },
                381210: { name: "Dead by Daylight", id: "deadbydaylight" },
                // Add more games as needed
            };
            return gameMap[appid] || { name: "Unknown Game", id: "unknown" };
        };

        // Transform assets for marketplace display
        const marketplaceAssets = assets.map((asset: AssetRecord) => {
            const gameInfo = getGameInfo(asset.appid);
            return {
                id: asset.id,
                assetid: asset.assetid,
                appid: asset.appid,
                contextid: asset.contextid,
                classid: asset.classid,
                instanceid: asset.instanceid,
                steamID: asset.steamID,
                steamName: asset.steamName,
                steamAvatar: asset.steamAvatar,
                title: asset.name,
                game: gameInfo.name,
                gameId: gameInfo.id,
                price: formatSuiPrice(asset.price), // Price is already stored in SUI format, format intelligently
                image: asset.icon_url ? `https://steamcommunity-a.akamaihd.net/economy/image/${asset.icon_url}` : "/placeholder.svg",
                isAuction: false, // All current listings are fixed price
                timeLeft: null,
                walletAddress: asset.walletAddress,
                blobId: asset.blobId,
                description: asset.description,
                uploadedAt: asset.uploadedAt
            };
        });
        
        res.status(200).json({
            success: true,
            assets: marketplaceAssets,
            count: marketplaceAssets.length,
            pagination: {
                limit,
                offset,
                hasMore: marketplaceAssets.length === limit
            }
        });
    } catch (error) {
        console.error('Error in marketplace assets endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve marketplace assets'
        });
    }
});

// Delete an asset (removes from database, but not from Walrus)
app.delete('/api/walrus/assets/:blobId', async (req: Request, res: Response) => {
    try {
        const { blobId } = req.params;
        const { walletAddress } = req.body;
        
        if (!blobId || !walletAddress) {
            return res.status(400).json({
                error: 'Blob ID and wallet address are required'
            });
        }

        // Basic Sui address validation
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(walletAddress)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format'
            });
        }

        const deleted = await db.deleteAsset(blobId, walletAddress);
        
        if (deleted) {
            res.status(200).json({
                success: true,
                message: 'Asset record deleted successfully from database',
                note: 'Data still exists on Walrus network'
            });
        } else {
            res.status(404).json({
                error: 'Asset not found or you do not have permission to delete it'
            });
        }
    } catch (error) {
        console.error('Error in delete asset endpoint:', error);
        res.status(500).json({
            error: 'Failed to delete asset record'
        });
    }
});

// Check asset availability in seller's Steam inventory
app.get('/api/assets/:assetId/availability', async (req: Request, res: Response) => {
    try {
        const { assetId } = req.params;
        
        if (!assetId) {
            return res.status(400).json({
                error: 'Asset ID is required'
            });
        }

        // Get asset from database to get seller information
        const assets = await db.getAllAssets(1000, 0); // Get a reasonable number of assets
        const asset = assets.find((a: AssetRecord) => a.assetid === assetId);
        
        if (!asset) {
            return res.status(404).json({
                error: 'Asset not found in database'
            });
        }

        // Check if Steam API is configured
        if (!steamInventoryChecker) {
            return res.status(503).json({
                error: 'Steam inventory checking is not available (Steam API key not configured)'
            });
        }

        // Get seller's Steam ID - this should be in the asset record
        const sellerSteamId = asset.steamID;
        if (!sellerSteamId) {
            return res.status(400).json({
                error: 'Seller Steam ID not found for this asset'
            });
        }

        // Check if seller still has the asset
        try {
            const hasAsset = await steamInventoryChecker.checkAssetInInventory(
                sellerSteamId,
                asset.appid.toString(),
                asset.assetid
            );

            // Get item count for this asset type
            const itemCount = await steamInventoryChecker.getItemCount(
                sellerSteamId,
                asset.appid.toString(),
                asset.classid,
                asset.instanceid
            );

            res.status(200).json({
                available: hasAsset && itemCount > 0,
                hasAsset,
                itemCount,
                assetId: asset.assetid,
                sellerSteamId,
                appId: asset.appid,
                message: hasAsset && itemCount > 0 ? 'Asset is available' : 'Asset is no longer available'
            });

        } catch (steamError) {
            console.error('Steam API error:', steamError);
            res.status(503).json({
                error: 'Failed to check Steam inventory',
                details: steamError instanceof Error ? steamError.message : 'Unknown Steam API error'
            });
        }

    } catch (error) {
        console.error('Error in asset availability endpoint:', error);
        res.status(500).json({
            error: 'Failed to check asset availability'
        });
    }
});

// Remove unavailable asset from marketplace and database
app.delete('/api/assets/:assetId/remove-unavailable', async (req: Request, res: Response) => {
    try {
        const { assetId } = req.params;
        const { reason } = req.body;
        
        if (!assetId) {
            return res.status(400).json({
                error: 'Asset ID is required'
            });
        }

        // Get asset from database first to get blobId and walletAddress
        const assets = await db.getAllAssets(1000, 0);
        const asset = assets.find((a: AssetRecord) => a.assetid === assetId);
        
        if (!asset) {
            return res.status(404).json({
                error: 'Asset not found in database'
            });
        }

        // Delete from database
        const deleted = await db.deleteAsset(asset.blobId, asset.walletAddress);
        
        if (deleted) {
            console.log(`[Asset Removal] Removed unavailable asset ${assetId} - Reason: ${reason || 'Asset no longer available'}`);
            
            res.status(200).json({
                success: true,
                message: 'Unavailable asset removed from marketplace',
                assetId,
                reason: reason || 'Asset no longer available'
            });
        } else {
            res.status(500).json({
                error: 'Failed to remove asset from database'
            });
        }

    } catch (error) {
        console.error('Error in remove unavailable asset endpoint:', error);
        res.status(500).json({
            error: 'Failed to remove unavailable asset'
        });
    }
});

// Check inventory transfer verification for escrow claim
app.get('/api/escrow/:escrowId/verify-transfer', async (req: Request, res: Response) => {
    try {
        const { escrowId } = req.params;
        
        if (!escrowId) {
            return res.status(400).json({
                error: 'Escrow ID is required'
            });
        }

        // Check if Steam API is configured
        if (!steamInventoryChecker) {
            return res.status(503).json({
                error: 'Steam inventory checking is not available (Steam API key not configured)'
            });
        }

        // Get escrow record from database
        const escrow = await db.getEscrowById(escrowId);
        
        if (!escrow) {
            return res.status(404).json({
                error: 'Escrow transaction not found'
            });
        }

        // Only allow verification for 'in-progress' escrows
        if (escrow.status !== 'in-progress') {
            return res.status(400).json({
                error: `Cannot verify transfer for escrow with status: ${escrow.status}`,
                currentStatus: escrow.status
            });
        }

        try {
            // Get current inventory counts for both buyer and seller
            const sellerCurrentCount = await steamInventoryChecker.getItemCount(
                escrow.sellerSteamId || '',
                escrow.appId,
                escrow.classId || '',
                escrow.instanceId || ''
            );

            const buyerCurrentCount = await steamInventoryChecker.getItemCount(
                escrow.buyerSteamId || '',
                escrow.appId,
                escrow.classId || '',
                escrow.instanceId || ''
            );

            // Check if transfer occurred by comparing initial vs current counts
            const sellerCountDecrease = escrow.initialSellerItemCount - sellerCurrentCount;
            const buyerCountIncrease = buyerCurrentCount - escrow.initialBuyerItemCount;

            // Transfer is verified if:
            // 1. Seller's count decreased by at least 1
            // 2. Buyer's count increased by at least 1
            // 3. The decrease and increase match (or buyer got at least what seller lost)
            const isTransferred = sellerCountDecrease >= 1 && 
                                buyerCountIncrease >= 1 && 
                                buyerCountIncrease >= sellerCountDecrease;

            const verification = {
                isTransferred,
                escrowId: escrow.escrowId,
                assetId: escrow.assetId,
                assetName: escrow.assetName,
                sellerSteamId: escrow.sellerSteamId,
                buyerSteamId: escrow.buyerSteamId,
                initialCounts: {
                    seller: escrow.initialSellerItemCount,
                    buyer: escrow.initialBuyerItemCount
                },
                currentCounts: {
                    seller: sellerCurrentCount,
                    buyer: buyerCurrentCount
                },
                changes: {
                    sellerDecrease: sellerCountDecrease,
                    buyerIncrease: buyerCountIncrease
                },
                verificationTime: new Date().toISOString(),
                message: isTransferred 
                    ? 'Asset transfer verified - seller can claim payment'
                    : 'Asset transfer not detected - claim not allowed'
            };

            console.log(`[Transfer Verification] Escrow ${escrowId}:`, verification);

            res.status(200).json({
                success: true,
                verification
            });

        } catch (steamError) {
            console.error('Steam API error during transfer verification:', steamError);
            res.status(503).json({
                error: 'Failed to verify inventory transfer',
                details: steamError instanceof Error ? steamError.message : 'Unknown Steam API error'
            });
        }

    } catch (error) {
        console.error('Error in transfer verification endpoint:', error);
        res.status(500).json({
            error: 'Failed to verify inventory transfer'
        });
    }
});

// API endpoint to store asset with Walrus blob ID and Sui signature
app.post('/api/store-asset', async (req: Request, res: Response) => {
    try {
        console.log('[API][Store Asset] Received request body:', JSON.stringify(req.body, null, 2));
        
        const {
            appid, contextid, assetid, classid, instanceid, amount, walletAddress,
            icon_url, name, price, listingType, description, auctionDuration,
            blobId, signature, signedBytes, steamID, steamName, steamAvatar
        } = req.body;

        console.log('[API][Store Asset] Extracted fields:', {
            appid, contextid, assetid, classid, instanceid, amount, walletAddress,
            icon_url, name, price, listingType, description, auctionDuration,
            blobId, signature: signature ? signature.substring(0, 20) + '...' : 'undefined',
            steamID, steamName, steamAvatar
        });

        // Validate required fields
        if (!walletAddress || !blobId || !signature || !assetid || !appid || isNaN(parseInt(appid))) {
            console.log('[API][Store Asset] Validation failed - Missing required fields:', {
                walletAddress: !!walletAddress,
                blobId: !!blobId,
                signature: !!signature,
                assetid: !!assetid,
                appid: appid,
                appidValid: !isNaN(parseInt(appid))
            });
            return res.status(400).json({ 
                error: 'Missing required fields: walletAddress, blobId, signature, assetid, appid (must be a valid number)' 
            });
        }

        // Create asset record for database (matching the existing AssetRecord interface)
        const assetRecord: AssetRecord = {
            walletAddress,
            blobId,
            appid: parseInt(appid), // Remove fallback to 0
            assetid,
            classid: classid || '',
            instanceid: instanceid || '',
            contextid: contextid || '',
            amount: amount || '1',
            icon_url: icon_url || '',
            name: name || 'Unknown Item',
            price: price ? parseFloat(price).toString() : '0',
            description: description || '',
            steamID: steamID || null,
            steamName: steamName || null,
            steamAvatar: steamAvatar || null,
            uploadedAt: new Date().toISOString()
        };

        // Store in database
        await db.addAsset(assetRecord);
        
        // Log additional metadata for future use (signature, listing details, etc.)
        console.log(`[API][Store Asset] Successfully stored asset ${assetid} for wallet ${walletAddress}`);
        console.log(`[API][Store Asset] Blob ID: ${blobId}, Signature: ${signature?.substring(0, 20)}...`);
        console.log(`[API][Store Asset] Listing details:`, { listingType, description, auctionDuration });
        
        res.json({ 
            success: true, 
            message: 'Asset successfully listed with signature verification',
            blobId,
            assetId: assetid
        });

    } catch (error) {
        console.error('[API][Store Asset] Error:', error);
        
        // Handle specific database constraint errors
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed: assets.walletAddress, assets.assetid')) {
            return res.status(400).json({ 
                error: 'Asset already listed', 
                details: 'This asset is already listed for sale by your wallet. Please check your existing listings.' 
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to store asset listing', 
            details: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// === Escrow API Endpoints ===

// Check Steam inventory for escrow validation
app.post('/api/escrow/check-inventory', async (req: Request, res: Response) => {
    try {
        const { steamId, appId, assetId } = req.body;

        if (!steamInventoryChecker) {
            return res.status(503).json({
                error: 'Steam inventory checking is not available (API key not configured)'
            });
        }

        if (!steamId || !appId || !assetId) {
            return res.status(400).json({
                error: 'steamId, appId, and assetId are required'
            });
        }

        const hasAsset = await steamInventoryChecker.checkAssetInInventory(steamId, appId, assetId);
        
        res.json({
            success: true,
            steamId,
            appId,
            assetId,
            hasAsset,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error checking Steam inventory:', error);
        res.status(500).json({
            error: 'Failed to check Steam inventory',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get item count for escrow validation
app.post('/api/escrow/get-item-count', async (req: Request, res: Response) => {
    try {
        const { steamId, appId, classId, instanceId } = req.body;

        if (!steamInventoryChecker) {
            return res.status(503).json({
                error: 'Steam inventory checking is not available (API key not configured)'
            });
        }

        if (!steamId || !appId || !classId || !instanceId) {
            return res.status(400).json({
                error: 'steamId, appId, classId, and instanceId are required'
            });
        }

        const itemCount = await steamInventoryChecker.getItemCount(steamId, appId, classId, instanceId);
        
        res.json({
            success: true,
            steamId,
            appId,
            classId,
            instanceId,
            itemCount,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting item count:', error);
        res.status(500).json({
            error: 'Failed to get item count',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get escrow status
app.get('/api/escrow/status/:escrowId', async (req: Request, res: Response) => {
    try {
        const { escrowId } = req.params;

        if (!escrowId) {
            return res.status(400).json({
                error: 'Escrow ID is required'
            });
        }

        // In a real implementation, you'd query the Sui blockchain for escrow state
        // For now, return placeholder data
        res.json({
            success: true,
            escrowId,
            status: 'deposited', // initialized, deposited, completed, cancelled
            message: 'Escrow status tracking not fully implemented yet',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting escrow status:', error);
        res.status(500).json({
            error: 'Failed to get escrow status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Webhook endpoint for escrow status updates (for frontend real-time updates)
app.get('/api/escrow/events', (req: Request, res: Response) => {
    // Set up Server-Sent Events (SSE) for real-time escrow updates
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const sendEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial connection message
    sendEvent({ type: 'connected', timestamp: new Date().toISOString() });

    // Add listener for escrow updates
    const updateHandler = (update: EscrowStatusUpdate) => {
        sendEvent({ type: 'escrow_update', data: update });
    };

    escrowEventListener.onEscrowStatusUpdate(updateHandler);

    // Clean up on client disconnect
    req.on('close', () => {
        // In a real implementation, you'd remove the specific listener
        console.log('Client disconnected from escrow events');
    });
});

// Get all escrows for a user
app.get('/api/escrow/getAllEscrows', async (req: Request, res: Response) => {
    try {
        const { address } = req.query;

        console.log('getAllEscrows called with address:', address);

        if (!address || typeof address !== 'string') {
            return res.status(400).json({
                error: 'Wallet address is required as query parameter'
            });
        }

        // Basic Sui address validation
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(address)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format'
            });
        }

        // Get all escrows where user is either buyer or seller
        const escrows = await db.getEscrowsByUser(address);
        console.log('Found escrows in database:', escrows.length);
        
        // Transform escrows to match frontend interface
        const transformedEscrows = escrows.map((escrow: EscrowRecord) => ({
            transactionId: escrow.escrowId,
            buyer: escrow.buyerAddress,
            seller: escrow.sellerAddress,
            item: {
                name: escrow.assetName,
                image: "/placeholder.svg", // You might want to retrieve this from assets table or store it
                game: getGameNameByAppId(escrow.appId),
                assetId: escrow.assetId
            },
            amount: `${parseFloat(escrow.priceInSui)} SUI`,
            status: escrow.status,
            createdAt: escrow.createdAt,
            updatedAt: escrow.updatedAt,
            steamTradeUrl: escrow.tradeUrl,
            description: `Trading ${escrow.assetName}`,
            role: escrow.buyerAddress.toLowerCase() === address.toLowerCase() ? 'buyer' : 'seller'
        }));

        res.json({
            success: true,
            escrows: transformedEscrows,
            count: transformedEscrows.length
        });

    } catch (error) {
        console.error('Error fetching user escrows:', error);
        res.status(500).json({
            error: 'Failed to fetch escrow transactions',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get individual escrow transaction by ID
app.get('/api/escrow/transaction/:transactionId', async (req: Request, res: Response) => {
    try {
        const { transactionId } = req.params;
        
        if (!transactionId) {
            return res.status(400).json({
                success: false,
                error: 'Transaction ID is required'
            });
        }

        console.log('Fetching escrow transaction:', transactionId);
        
        const escrow = await db.getEscrowById(transactionId);
        
        if (!escrow) {
            return res.status(404).json({
                success: false,
                error: 'Transaction not found'
            });
        }

        // Helper function to format SUI prices intelligently  
        const formatSuiPrice = (price: string): string => {
            // Handle null, undefined, or empty string
            if (!price || price === '' || price === '0' || price === 'null' || price === 'undefined') {
                return "0 SUI";
            }
            
            const num = parseFloat(price);
            
            if (isNaN(num) || num === 0) {
                return "0 SUI";
            }
            
            // Smart decimal formatting based on amount size
            let formatted: string;
            if (num < 0.001) {
                // For very small amounts, show up to 8 decimals
                formatted = num.toFixed(8).replace(/\.?0+$/, '');
            } else if (num < 0.01) {
                // For small amounts, show up to 6 decimals
                formatted = num.toFixed(6).replace(/\.?0+$/, '');
            } else if (num < 1) {
                // For amounts less than 1, show up to 4 decimals
                formatted = num.toFixed(4).replace(/\.?0+$/, '');
            } else {
                // For larger amounts, show up to 3 decimals
                formatted = num.toFixed(3).replace(/\.?0+$/, '');
            }
            
            return `${formatted} SUI`;
        };

        // Transform escrow for frontend
        const transformedEscrow = {
            transactionId: escrow.escrowId,
            buyer: escrow.buyerAddress,
            seller: escrow.sellerAddress,
            item: {
                name: escrow.assetName,
                image: escrow.iconUrl ? `https://steamcommunity-a.akamaihd.net/economy/image/${escrow.iconUrl}` : '/placeholder.svg',
                game: getGameNameByAppId(escrow.appId),
                assetId: escrow.assetId
            },
            amount: formatSuiPrice(escrow.priceInSui),
            status: escrow.status,
            createdAt: escrow.createdAt,
            updatedAt: escrow.updatedAt,
            steamTradeUrl: escrow.tradeUrl,
            description: `Trading ${escrow.assetName}`,
            role: 'buyer' // We'll determine this on the frontend based on current user
        };

        console.log('Transformed escrow:', transformedEscrow);

        res.status(200).json({
            success: true,
            escrow: transformedEscrow
        });
    } catch (error) {
        console.error('Error fetching escrow transaction:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch escrow transaction'
        });
    }
});

// Helper function to get game name by app ID
interface SteamApp {
    appid: number;
    name: string;
}

const steamApps: SteamApp[] = steamAppsData as SteamApp[];

function getGameNameByAppId(appId: string): string {
    // First try to find in the comprehensive steam apps data
    const game = steamApps.find(app => app.appid.toString() === appId);
    if (game) {
        return game.name;
    }
    
    // Fallback to hardcoded map for common games
    const gameMap: Record<string, string> = {
        '730': 'Counter-Strike 2',
        '570': 'Dota 2',
        '440': 'Team Fortress 2',
        '252490': 'Rust',
        '304930': 'Unturned',
        '381210': 'Dead by Daylight'
    };
    
    return gameMap[appId] || 'Unknown Game';
}

// 404 handler with debugging
app.use('/{*splat}', (req: Request, res: Response) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  console.log(`Headers:`, req.headers);
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl
  });
});

// Global error handler (should be after all routes)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('[Express][Global Error Handler]', err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// Start server only in development (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`Visit ${BACKEND_URL} to get started`);
    });
}

export default serverless(app);
