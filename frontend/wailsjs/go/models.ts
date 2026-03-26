export namespace agent {
	
	export class Agent {
	    id: string;
	    runId: number;
	    projectId: number;
	    type: string;
	    displayName: string;
	    command: string;
	    status: string;
	    taskDescription: string;
	    ptySessionId: string;
	    // Go type: time
	    startedAt: any;
	    exitCode?: number;
	
	    static createFrom(source: any = {}) {
	        return new Agent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.runId = source["runId"];
	        this.projectId = source["projectId"];
	        this.type = source["type"];
	        this.displayName = source["displayName"];
	        this.command = source["command"];
	        this.status = source["status"];
	        this.taskDescription = source["taskDescription"];
	        this.ptySessionId = source["ptySessionId"];
	        this.startedAt = this.convertValues(source["startedAt"], null);
	        this.exitCode = source["exitCode"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SpawnResult {
	    agentId: string;
	    ptySessionId: string;
	
	    static createFrom(source: any = {}) {
	        return new SpawnResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.agentId = source["agentId"];
	        this.ptySessionId = source["ptySessionId"];
	    }
	}

}

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

