class DelayDetector {
    startTime: number;
    endTime: number;
    tag: string;

    constructor(tag: string = '') {
        this.startTime = new Date().getTime();
        this.tag = tag;
    }

    estimate(log: boolean = true): number {
        this.endTime = new Date().getTime();
        const spent = this.endTime - this.startTime;
        if (log) {
            console.log(`[${this.tag}] Duration: ${spent} ms`);
        }

        return spent;
    }
}

export { DelayDetector };
