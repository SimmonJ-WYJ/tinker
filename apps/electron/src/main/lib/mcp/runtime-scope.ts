/** Scientific environment setup must not block generic capability requests. */
export async function preparePaperSearchRuntime(
 servers: Record<string, unknown>,
 scope: {scientific: boolean; hasSession: boolean},
 sync: () => Promise<void>,
): Promise<void> {
 if(!scope.scientific) {delete servers['paper-search'];return}
 if(scope.hasSession && servers['paper-search']) await sync()
}
