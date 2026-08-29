export type DatabaseIdeCellValue = string | number | boolean | null;

export const parseDatabaseIdeCsv = (input: string): string[][] => {
	if (!input) return [];
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;

	for (let index = 0; index < input.length; index += 1) {
		const character = input[index];
		if (quoted) {
			if (character === '"' && input[index + 1] === '"') {
				field += '"';
				index += 1;
			} else if (character === '"') {
				quoted = false;
			} else {
				field += character;
			}
			continue;
		}

		if (character === '"') {
			quoted = true;
		} else if (character === ",") {
			row.push(field);
			field = "";
		} else if (character === "\n") {
			row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += character;
		}
	}

	if (field || row.length > 0) {
		row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
		rows.push(row);
	}
	return rows;
};

export const decodeDatabaseIdeMysqlField = (
	value: string | undefined,
): DatabaseIdeCellValue => {
	if (value === undefined || value === "NULL") return null;
	return value.replace(/\\(0|b|n|r|t|Z|\\)/g, (_match, sequence: string) => {
		switch (sequence) {
			case "0":
				return "\0";
			case "b":
				return "\b";
			case "n":
				return "\n";
			case "r":
				return "\r";
			case "t":
				return "\t";
			case "Z":
				return "\x1a";
			default:
				return "\\";
		}
	});
};
