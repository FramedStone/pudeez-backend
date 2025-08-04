import  sqlite3  from "sqlite3";


const TABLE_NAME = "user";

export interface User {
    address: string,
    steamID: number
}

export class Database {
    rawDb: sqlite3.Database;

    constructor(filename: string) {
        this.rawDb = new sqlite3.Database(filename);
    }

    /**
     * Add a new row with address (hex) and steamID (decimal)
     */
    addRow(address: string, steamID: number): void {
        this.rawDb.exec(
            `INSERT INTO ${TABLE_NAME} VALUES ('${address}', ${steamID})`,
            (err: Error | null) => {
                console.error(err)
            }
        )
    }

    /**
     * Get steamID from address
     */
    getSteamID(address: string): number | undefined {
        let result;
        this.rawDb.get(
            `SELECT steam_id FROM ${TABLE_NAME} WHERE address = ${address}`,
            (err: Error | null, row: User) => {
                if (row)
                    result = row.address;
            }
        );

        return result;
    }
}
