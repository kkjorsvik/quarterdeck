export namespace filetree {
	
	export class FileEntry {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	    }
	}

}

export namespace project {
	
	export class Project {
	    id: number;
	    name: string;
	    path: string;
	    gitDefaultBranch: string;
	    devServerUrl: string;
	    devServerCommand: string;
	    defaultAgentType: string;
	    sortOrder: number;
	    color: string;
	    notes: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.gitDefaultBranch = source["gitDefaultBranch"];
	        this.devServerUrl = source["devServerUrl"];
	        this.devServerCommand = source["devServerCommand"];
	        this.defaultAgentType = source["defaultAgentType"];
	        this.sortOrder = source["sortOrder"];
	        this.color = source["color"];
	        this.notes = source["notes"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class UpdateFields {
	    Name?: string;
	    Path?: string;
	    GitDefaultBranch?: string;
	    DevServerURL?: string;
	    DevServerCommand?: string;
	    DefaultAgentType?: string;
	    SortOrder?: number;
	    Color?: string;
	    Notes?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateFields(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Path = source["Path"];
	        this.GitDefaultBranch = source["GitDefaultBranch"];
	        this.DevServerURL = source["DevServerURL"];
	        this.DevServerCommand = source["DevServerCommand"];
	        this.DefaultAgentType = source["DefaultAgentType"];
	        this.SortOrder = source["SortOrder"];
	        this.Color = source["Color"];
	        this.Notes = source["Notes"];
	    }
	}

}

