import { Context } from "@hulala/cordis";

async function main(): Promise<void> {
  const ctx = new Context();
  const dispose = ctx.effect(() => () => undefined, "vendor.check");
  await Promise.resolve(dispose());
  console.log("vendor cordis context ok");
}

void main();
