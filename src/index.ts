export enum JobStatus {
    PENDING,
    RUNNING,
    RESOLVED,
    REJECTED,
    CANCELED,
};

export interface TaskBody<T = any> {
    (...args: any[]): T;
    name?: string;
    args?: any[];
}

export interface TaskDescriptor<T = any> {
    name?: string;
    body: TaskBody<T>;
    args?: any[];
}

export interface TaskValueMapper<T, R> {
    (value: T, index: number, from: Iterable<T>): R;
}

export interface TaskValueExecutor<T> {
    (value: T, index: number, from: Iterable<T>): any;
}

export type Task<T = any> = TaskBody<T> | TaskDescriptor<T>;

export interface JobWatcher<T = any> {
    (job: Job<T>): any;
}

export class Job<T = any> {
    public readonly id: number;
    public readonly name: string;
    public readonly promise: Promise<T>;

    private readonly _body: TaskBody<T>;
    private readonly _args: any[];
    private readonly _watchers: JobWatcher<T>[];
    private _scheduler: TaskScheduler;
    private _status: JobStatus;
    private _onResolve?: (value: any) => any;
    private _onReject?: (reason?: any) => any;

    constructor(id: number, task: Task, scheduler: TaskScheduler) {
        this.id = id;
        this._scheduler = scheduler;
        this.name = task.name || `${this._scheduler.name}-${this.id}`;
        this._status = JobStatus.PENDING;
        this._body = typeof task === 'function' ? task : task.body;
        this._args = task.args || [];
        this.promise = new Promise((resolve, reject) => {
            this._onResolve = resolve;
            this._onReject = reject;
        });
        this._watchers = [];
    }

    get status() {
        return this._status;
    }

    get pending() {
        return this._status === JobStatus.PENDING;
    }

    get running() {
        return this._status === JobStatus.RUNNING;
    }

    get finished() {
        return this._status === JobStatus.RESOLVED
            || this._status === JobStatus.REJECTED
            || this._status === JobStatus.CANCELED;
    }

    watch(watcher: JobWatcher<T>) {
        this._watchers.push(watcher);
        return this;
    }

    cancel(reason?: any) {
        if (this.pending) {
            this._onReject!(reason);
            this._status = JobStatus.CANCELED;
            this._notifyChange();
            return true;
        }
        return false;
    }

    toString() {
        return `[${this.constructor.name}: ${this.id} ${this._scheduler.name}::${this.name}]`;
    }

    /** @internal */
    _execute() {
        if (this.pending) {
            Promise.resolve()
                .then(() => {
                    this._status = JobStatus.RUNNING;
                    this._notifyChange();
                    return this._body(...this._args);
                })
                .then((result) => {
                    this._onResolve!(result);
                    this._status = JobStatus.RESOLVED;
                    this._notifyChange();
                }, (reason) => {
                    this._onReject!(reason);
                    this._status = JobStatus.REJECTED;
                    this._notifyChange();
                });
        }
    }

    private _notifyChange() {
        this._scheduler._onJobChange(this);
        this._watchers.forEach(watcher => watcher(this));
    }
}

export interface TaskSchedulerOptions {
    name: string;
    maxJobs: number;
}

export class TaskScheduler {

    private static readonly _instance = new TaskScheduler({ name: 'global' });

    private _options: TaskSchedulerOptions;
    private _jobSequence: number;
    private _pendingJobs: Job[];
    private _jobWatchers: JobWatcher[];
    private _runningJobs: { [ID: number]: Job };

    constructor(options?: Partial<TaskSchedulerOptions>) {
        options = options || {};
        this._options = {
            name: options.name || '???',
            maxJobs: options.maxJobs || 8,
        };
        this._jobSequence = 0;
        this._pendingJobs = [];
        this._runningJobs = {};
        this._jobWatchers = [];
    }

    static get instance() {
        return TaskScheduler._instance;
    }

    get name() {
        return this._options.name;
    }

    watch(watcher: JobWatcher) {
        this._jobWatchers.push(watcher);
        return this;
    }

    addJob<T>(task: Task<T>): Job<T> {
        return this._push(task);
    }

    async add<T>(task: Task<T>): Promise<T> {
        const job = this.addJob(task);
        return job.promise;
    }

    mapJobs<R, T, A extends Iterable<T>>(iterable: A, body: TaskValueMapper<T, R>): Job<R>[] {
        const tasks: TaskDescriptor[] = Array.from(iterable).map((value, index) => ({ args: [value, index, iterable], body }) );
        const jobs = tasks.map(task => this._push(task));
        return jobs;
    }

    async mapAll<R, T, A extends Iterable<T>>(iterable: A, body: TaskValueMapper<T, R>): Promise<R[]> {
        const jobs = this.mapJobs(iterable, body);
        return Promise.all(jobs.map(item => item.promise));
    }

    async mapRace<R, T, A extends Iterable<T>>(iterable: A, body: TaskValueMapper<T, R>): Promise<R> {
        const jobs = this.mapJobs(iterable, body);
        return Promise.race(jobs.map(item => item.promise));
    }

    forEachJob<T, A extends Iterable<T>>(iterable: A, body: TaskValueExecutor<T>): Job<any>[] {
        return this.mapJobs(iterable, body);
    }

    async forAll<T, A extends Iterable<T>>(iterable: A, body: TaskValueExecutor<T>): Promise<any[]> {
        return this.mapAll(iterable, body);
    }

    async forRace<T, A extends Iterable<T>>(iterable: A, body: TaskValueExecutor<T>): Promise<any> {
        return this.mapRace(iterable, body);
    }

    /** @internal */
    _onJobChange(job: Job) {
        this._updateWatchers(job);

        if (job.finished) {
            delete this._runningJobs[job.id];
            this._run();
        }
    }

    private _push(task: Task): Job {
        const job = new Job(this._jobSequence++, task, this);
        this._pendingJobs.push(job);
        this._updateWatchers(job);
        this._run();
        return job;
    }

    private async _run() {
        const runningJobIds = Object.keys(this._runningJobs);
        let newJobsCount = this._options.maxJobs - runningJobIds.length;
        if (newJobsCount > 0) {
            while (newJobsCount-- && this._pendingJobs.length > 0) {
                const job = this._pendingJobs.shift()!;
                this._runningJobs[job.id] = job;
                job._execute();
            }
        }
    }

    private _updateWatchers(job: Job) {
        this._jobWatchers.forEach(watcher => watcher(job));
    }
}
