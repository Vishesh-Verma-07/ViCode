import fs from "fs"
import path from "path"

const LOG_FILE = path.join(process.cwd(), "debug.log");

export function log(...args: unknown[]): void {

    const timeStamp = new Date().toISOString();

    const formated = args
        .map((arg) => 
            typeof arg == "string" ? arg : JSON.stringify(arg, null, 2)
        )
        .join("");

    fs.appendFileSync(LOG_FILE, `[${timeStamp}] ${formated}\n`);


}