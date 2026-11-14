/**
 * Repositories set up on demand: a tracker that gets work for a repository
 * nyrus has no entry for yet (e.g. the first GitHub issue assigned in it)
 * asks; an integration that knows the repository (inBudget) clones it and
 * adds its entry. Shared by all integrations of one edge worker.
 */
export type RepositoryProvisioner = (
	platform: string,
	repo: string,
) => Promise<boolean>;

export class RepositoryProvisioning {
	private readonly provisioners: RepositoryProvisioner[] = [];

	register(provisioner: RepositoryProvisioner): void {
		this.provisioners.push(provisioner);
	}

	/** True if a provisioner set the repository up (its entry is being loaded). */
	async provide(platform: string, repo: string): Promise<boolean> {
		for (const provisioner of this.provisioners) {
			if (await provisioner(platform, repo).catch(() => false)) return true;
		}
		return false;
	}
}
