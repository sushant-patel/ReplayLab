
// A function with a typed parameter and a typed return value.
function describeRuntime(name: string): string {
    // Template literal: backticks + ${} insert values into a string
    return `Hello from ${name}, running on Node ${process.version}`;
}

console.log(describeRuntime("ReplayLab"));

