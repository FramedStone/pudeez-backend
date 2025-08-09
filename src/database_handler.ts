import  sqlite3  from "sqlite3";


const TABLE_NAME = "user";
const ASSETS_TABLE_NAME = "assets";
const ESCROW_TABLE_NAME = "escrows";

export interface User {
    address: string,
    steamID: string
}

export interface AssetRecord {
    id?: number;
    walletAddress: string;
    blobId: string;
    appid: number;
    assetid: string;
    classid: string;
    instanceid: string;
    contextid: string;
    amount: string;
    icon_url: string;
    name: string;
    price: string;
    description?: string;
    steamID?: string;
    steamName?: string;
    steamAvatar?: string;
    uploadedAt: string;
}

export interface EscrowRecord {
    id?: number;
    escrowId: string; // Sui object ID
    buyerAddress: string;
    sellerAddress: string;
    buyerSteamId?: string;
    sellerSteamId?: string;
    assetId: string;
    assetName: string;
    assetAmount: number;
    appId: string;
    classId?: string;
    instanceId?: string;
    tradeUrl: string;
    priceInSui: string;
    initialSellerItemCount: number;
    initialBuyerItemCount: number;
    status: 'in-progress' | 'cancelled' | 'completed';
    transactionDigest?: string;
    blobId?: string; // For Walrus storage
    createdAt: string;
    updatedAt: string;
}

export interface SteamAssetResponse {
    appid: number;
    contextid: string;
    assetid: string;
    classid: string;
    instanceid: string;
    amount: string;
}

export interface SteamDescriptionResponse {
    appid: number;
    classid: string;
    instanceid: string;
    icon_url: string;
    market_hash_name?: string;
    name?: string;
    type?: string;
    [key: string]: any; // Allow for other properties
}

export interface SteamInventoryResponse {
    assets?: SteamAssetResponse[];
    descriptions?: SteamDescriptionResponse[];
    success: number;
    error?: string;
}

export interface SteamInventoryItem {
    appid: number;
    contextid: string;
    assetid: string;
    classid: string;
    instanceid: string;
    amount: string;
    icon_url: string;
    name: string;
}


export class Database {
    rawDb: sqlite3.Database;

    constructor(filename: string) {
        this.rawDb = new sqlite3.Database(filename);
        this.initializeUserTable();
        this.initializeAssetsTable();
        this.initializeEscrowTable();
    }

    /**
     * Initialize the user table if it doesn't exist
     */
    private initializeUserTable(): void {
        const createUserTable = `
            CREATE TABLE IF NOT EXISTS user (
                address TEXT PRIMARY KEY,
                steamID TEXT
            )
        `;
        this.rawDb.exec(createUserTable, (err: Error | null) => {
            if (err) {
                console.error('Error creating user table:', err);
            } else {
                console.log('User table initialized successfully');
            }
        });
    }

    /**
     * Initialize the assets table if it doesn't exist
     */
    private initializeAssetsTable(): void {
        const createAssetsTable = `
            CREATE TABLE IF NOT EXISTS ${ASSETS_TABLE_NAME} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                walletAddress TEXT NOT NULL,
                blobId TEXT NOT NULL UNIQUE,
                appid INTEGER NOT NULL,
                assetid TEXT NOT NULL,
                classid TEXT NOT NULL,
                instanceid TEXT NOT NULL,
                contextid TEXT NOT NULL,
                amount TEXT NOT NULL,
                icon_url TEXT NOT NULL,
                name TEXT NOT NULL,
                price TEXT NOT NULL,
                description TEXT,
                steamID TEXT,
                steamName TEXT,
                steamAvatar TEXT,
                uploadedAt TEXT NOT NULL,
                UNIQUE(walletAddress, assetid)
            )
        `;
        this.rawDb.exec(createAssetsTable, (err: Error | null) => {
            if (err) {
                console.error('Error creating assets table:', err);
            } else {
                console.log('Assets table initialized successfully');
                // Run migrations after table creation
                this.runMigrations();
            }
        });
    }

    /**
     * Initialize the escrow table if it doesn't exist
     */
    private initializeEscrowTable(): void {
        const createEscrowTable = `
            CREATE TABLE IF NOT EXISTS ${ESCROW_TABLE_NAME} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                escrowId TEXT NOT NULL UNIQUE,
                buyerAddress TEXT NOT NULL,
                sellerAddress TEXT NOT NULL,
                buyerSteamId TEXT,
                sellerSteamId TEXT,
                assetId TEXT NOT NULL,
                assetName TEXT NOT NULL,
                assetAmount INTEGER NOT NULL,
                appId TEXT NOT NULL,
                classId TEXT,
                instanceId TEXT,
                tradeUrl TEXT NOT NULL,
                priceInSui TEXT NOT NULL,
                initialSellerItemCount INTEGER NOT NULL,
                initialBuyerItemCount INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'in-progress' CHECK(status IN ('in-progress', 'cancelled', 'completed')),
                transactionDigest TEXT,
                blobId TEXT,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            )
        `;
        this.rawDb.exec(createEscrowTable, (err: Error | null) => {
            if (err) {
                console.error('Error creating escrow table:', err);
            } else {
                console.log('Escrow table initialized successfully');
            }
        });
    }

    /**
     * Run database migrations to add missing columns
     */
    private runMigrations(): void {
        // Check if steamID column exists, if not add it
        this.rawDb.get(`PRAGMA table_info(${ASSETS_TABLE_NAME})`, (err: Error | null, result: any) => {
            if (err) {
                console.error('Error checking table info:', err);
                return;
            }
            
            // Get all columns
            this.rawDb.all(`PRAGMA table_info(${ASSETS_TABLE_NAME})`, (err: Error | null, columns: any[]) => {
                if (err) {
                    console.error('Error getting table columns:', err);
                    return;
                }
                
                const columnNames = columns.map(col => col.name);
                
                // Add steamID column if it doesn't exist
                if (!columnNames.includes('steamID')) {
                    this.rawDb.exec(`ALTER TABLE ${ASSETS_TABLE_NAME} ADD COLUMN steamID TEXT`, (err: Error | null) => {
                        if (err) {
                            console.error('Error adding steamID column:', err);
                        } else {
                            console.log('Added steamID column to assets table');
                        }
                    });
                }
                
                // Add steamName column if it doesn't exist
                if (!columnNames.includes('steamName')) {
                    this.rawDb.exec(`ALTER TABLE ${ASSETS_TABLE_NAME} ADD COLUMN steamName TEXT`, (err: Error | null) => {
                        if (err) {
                            console.error('Error adding steamName column:', err);
                        } else {
                            console.log('Added steamName column to assets table');
                        }
                    });
                }
                
                // Add steamAvatar column if it doesn't exist
                if (!columnNames.includes('steamAvatar')) {
                    this.rawDb.exec(`ALTER TABLE ${ASSETS_TABLE_NAME} ADD COLUMN steamAvatar TEXT`, (err: Error | null) => {
                        if (err) {
                            console.error('Error adding steamAvatar column:', err);
                        } else {
                            console.log('Added steamAvatar column to assets table');
                        }
                    });
                }
            });
        });
    }

    /**
     * Add a new row with address (hex) and steamID (decimal)
     */
    addRow(address: string, steamID: string, callback: (err: Error | null) => void): void {
        if (!address) {
            callback(new Error('Address is required for addRow'));
            return;
        }
        const normalizedAddress = address.trim().toLowerCase();
        const insertQuery = `INSERT INTO ${TABLE_NAME} (address, steamID) VALUES (?, ?)`;
        console.log('[addRow] SQL:', insertQuery, 'Params:', [normalizedAddress, steamID]);
        this.rawDb.run(
            insertQuery,
            [normalizedAddress, steamID],
            (err: Error | null) => {
                callback(err);
            }
        );
    }

    /**
     * Get steamID from address
     */
    getSteamID(address: string, callback: (err: Error | null, steamID?: string) => void): void {
        if (!address) {
            callback(new Error('Address is required for getSteamID'));
            return;
        }
        const normalizedAddress = address.trim().toLowerCase();
        const selectQuery = `SELECT steamID FROM ${TABLE_NAME} WHERE address = ?`;
        console.log('[getSteamID] SQL:', selectQuery, 'Params:', [normalizedAddress]);
        this.rawDb.get(
            selectQuery,
            [normalizedAddress],
            (err: Error | null, row: User) => {
                if (err) return callback(err);
                callback(null, row ? String(row.steamID) : undefined);
            }
        );
    }

    /**
     * Add a new asset record to the database
     */
    addAsset(assetRecord: AssetRecord): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const insertQuery = `
                INSERT INTO ${ASSETS_TABLE_NAME} 
                (walletAddress, blobId, appid, assetid, classid, instanceid, contextid, amount, icon_url, name, price, description, steamID, steamName, steamAvatar, uploadedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            this.rawDb.run(
                insertQuery,
                [
                    assetRecord.walletAddress,
                    assetRecord.blobId,
                    assetRecord.appid,
                    assetRecord.assetid,
                    assetRecord.classid,
                    assetRecord.instanceid,
                    assetRecord.contextid,
                    assetRecord.amount,
                    assetRecord.icon_url,
                    assetRecord.name,
                    assetRecord.price,
                    assetRecord.description || null,
                    assetRecord.steamID || null,
                    assetRecord.steamName || null,
                    assetRecord.steamAvatar || null,
                    assetRecord.uploadedAt
                ],
                function(err: Error | null) {
                    if (err) {
                        console.error('Error adding asset:', err);
                        reject(err);
                    } else {
                        console.log('Asset added successfully with ID:', this.lastID);
                        resolve(true);
                    }
                }
            );
        });
    }

    /**
     * Get all assets for a specific wallet address
     */
    getAssetsByWallet(walletAddress: string): Promise<AssetRecord[]> {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM ${ASSETS_TABLE_NAME} 
                WHERE walletAddress = ? 
                ORDER BY uploadedAt DESC
            `;
            
            this.rawDb.all(query, [walletAddress], (err: Error | null, rows: AssetRecord[]) => {
                if (err) {
                    console.error('Error fetching assets by wallet:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    /**
     * Get all assets (with optional pagination)
     */
    getAllAssets(limit?: number, offset?: number): Promise<AssetRecord[]> {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT * FROM ${ASSETS_TABLE_NAME} 
                ORDER BY uploadedAt DESC
            `;
            
            const params: any[] = [];
            if (limit) {
                query += ' LIMIT ?';
                params.push(limit);
                if (offset) {
                    query += ' OFFSET ?';
                    params.push(offset);
                }
            }
            
            this.rawDb.all(query, params, (err: Error | null, rows: AssetRecord[]) => {
                if (err) {
                    console.error('Error fetching all assets:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    /**
     * Get asset by blob ID
     */
    getAssetByBlobId(blobId: string): Promise<AssetRecord | null> {
        return new Promise((resolve, reject) => {
            const query = `SELECT * FROM ${ASSETS_TABLE_NAME} WHERE blobId = ?`;
            
            this.rawDb.get(query, [blobId], (err: Error | null, row: AssetRecord) => {
                if (err) {
                    console.error('Error fetching asset by blob ID:', err);
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    /**
     * Delete an asset record
     */
    deleteAsset(blobId: string, walletAddress: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const query = `
                DELETE FROM ${ASSETS_TABLE_NAME} 
                WHERE blobId = ? AND walletAddress = ?
            `;
            
            this.rawDb.run(query, [blobId, walletAddress], function(err: Error | null) {
                if (err) {
                    console.error('Error deleting asset:', err);
                    reject(err);
                } else {
                    resolve(this.changes > 0);
                }
            });
        });
    }

    /**
     * Get all users in the database
     */
    getAllUsers(): Promise<User[]> {
        return new Promise((resolve, reject) => {
            const query = `SELECT * FROM ${TABLE_NAME}`;
            this.rawDb.all(query, [], (err: Error | null, rows: User[]) => {
                if (err) {
                    console.error('Error fetching all users:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    // === Escrow Methods ===

    /**
     * Add a new escrow record
     */
    addEscrow(escrowRecord: EscrowRecord): Promise<number> {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO ${ESCROW_TABLE_NAME} (
                    escrowId, buyerAddress, sellerAddress, buyerSteamId, sellerSteamId,
                    assetId, assetName, assetAmount, appId, classId, instanceId,
                    tradeUrl, priceInSui, initialSellerItemCount, initialBuyerItemCount,
                    status, transactionDigest, blobId, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const params = [
                escrowRecord.escrowId,
                escrowRecord.buyerAddress,
                escrowRecord.sellerAddress,
                escrowRecord.buyerSteamId,
                escrowRecord.sellerSteamId,
                escrowRecord.assetId,
                escrowRecord.assetName,
                escrowRecord.assetAmount,
                escrowRecord.appId,
                escrowRecord.classId,
                escrowRecord.instanceId,
                escrowRecord.tradeUrl,
                escrowRecord.priceInSui,
                escrowRecord.initialSellerItemCount,
                escrowRecord.initialBuyerItemCount,
                escrowRecord.status,
                escrowRecord.transactionDigest,
                escrowRecord.blobId,
                escrowRecord.createdAt,
                escrowRecord.updatedAt
            ];
            
            this.rawDb.run(query, params, function(err: Error | null) {
                if (err) {
                    console.error('Error adding escrow:', err);
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }

    /**
     * Update escrow status
     */
    updateEscrowStatus(escrowId: string, status: 'in-progress' | 'cancelled' | 'completed', transactionDigest?: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE ${ESCROW_TABLE_NAME} 
                SET status = ?, updatedAt = ?, transactionDigest = COALESCE(?, transactionDigest)
                WHERE escrowId = ?
            `;
            
            const updatedAt = new Date().toISOString();
            
            this.rawDb.run(query, [status, updatedAt, transactionDigest, escrowId], function(err: Error | null) {
                if (err) {
                    console.error('Error updating escrow status:', err);
                    reject(err);
                } else {
                    resolve(this.changes > 0);
                }
            });
        });
    }

    /**
     * Get escrow by ID
     */
    getEscrowById(escrowId: string): Promise<EscrowRecord | null> {
        return new Promise((resolve, reject) => {
            const query = `SELECT * FROM ${ESCROW_TABLE_NAME} WHERE escrowId = ?`;
            
            this.rawDb.get(query, [escrowId], (err: Error | null, row: EscrowRecord) => {
                if (err) {
                    console.error('Error fetching escrow by ID:', err);
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    /**
     * Get escrows by buyer address
     */
    getEscrowsByBuyer(buyerAddress: string): Promise<EscrowRecord[]> {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM ${ESCROW_TABLE_NAME} 
                WHERE buyerAddress = ? 
                ORDER BY createdAt DESC
            `;
            
            this.rawDb.all(query, [buyerAddress], (err: Error | null, rows: EscrowRecord[]) => {
                if (err) {
                    console.error('Error fetching escrows by buyer:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    /**
     * Get escrows by seller address
     */
    getEscrowsBySeller(sellerAddress: string): Promise<EscrowRecord[]> {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM ${ESCROW_TABLE_NAME} 
                WHERE sellerAddress = ? 
                ORDER BY createdAt DESC
            `;
            
            this.rawDb.all(query, [sellerAddress], (err: Error | null, rows: EscrowRecord[]) => {
                if (err) {
                    console.error('Error fetching escrows by seller:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    /**
     * Get all escrows with optional status filter
     */
    getAllEscrows(status?: 'in-progress' | 'cancelled' | 'completed'): Promise<EscrowRecord[]> {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM ${ESCROW_TABLE_NAME}`;
            const params: any[] = [];
            
            if (status) {
                query += ' WHERE status = ?';
                params.push(status);
            }
            
            query += ' ORDER BY createdAt DESC';
            
            this.rawDb.all(query, params, (err: Error | null, rows: EscrowRecord[]) => {
                if (err) {
                    console.error('Error fetching all escrows:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }
}
