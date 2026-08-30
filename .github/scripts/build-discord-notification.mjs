import { appendFile, readFile, writeFile } from "node:fs/promises";

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const eventName = process.env.EVENT_NAME;
const action = process.env.EVENT_ACTION || event.action;
const outputPath = process.env.GITHUB_OUTPUT;
const payloadPath = process.env.DISCORD_PAYLOAD_PATH;

const colors = {
	blocked: 0xd93f0b,
	failure: 0xd73a4a,
	info: 0x1d76db,
	success: 0x2da44e,
	warning: 0xfbca04,
};

const productionBranches = new Set(["main"]);

const truncate = (value, length) => {
	const text = String(value ?? "").trim();
	return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
};

const linkedTitle = (title, url) =>
	url ? `[${truncate(title, 300)}](${url})` : truncate(title, 300);

const repository = event.repository ?? {};
const actor = event.sender ?? event.review?.user ?? {};
let notification;

if (eventName === "workflow_dispatch") {
	notification = {
		color: colors.success,
		description:
			"Webhooken og GitHub Actions-secreten er koblet opp riktig.",
		title: "✅ Discord-varsling er aktivert",
		url: repository.html_url,
	};
}

if (eventName === "issues") {
	const issue = event.issue;
	const description = linkedTitle(issue.title, issue.html_url);

	if (action === "opened") {
		notification = {
			color: colors.info,
			description,
			title: `🆕 Sak #${issue.number} ble opprettet`,
			url: issue.html_url,
		};
	}

	if (action === "labeled") {
		const label = event.label?.name?.toLocaleLowerCase("nb-NO");

		if (label === "pågår") {
			notification = {
				color: colors.warning,
				description,
				title: `🛠️ Arbeid startet på sak #${issue.number}`,
				url: issue.html_url,
			};
		}

		if (label === "blokkert") {
			notification = {
				color: colors.blocked,
				description,
				title: `⛔ Sak #${issue.number} er blokkert`,
				url: issue.html_url,
			};
		}
	}

	if (action === "closed") {
		const completed = issue.state_reason !== "not_planned";
		notification = {
			color: completed ? colors.success : colors.info,
			description,
			title: completed
				? `✅ Sak #${issue.number} ble løst`
				: `🚫 Sak #${issue.number} ble lukket som ikke planlagt`,
			url: issue.html_url,
		};
	}

	if (action === "reopened") {
		notification = {
			color: colors.warning,
			description,
			title: `↩️ Sak #${issue.number} ble gjenåpnet`,
			url: issue.html_url,
		};
	}
}

if (eventName === "pull_request") {
	const pullRequest = event.pull_request;
	const description = linkedTitle(pullRequest.title, pullRequest.html_url);

	if (action === "opened") {
		notification = {
			color: pullRequest.draft ? colors.warning : colors.info,
			description,
			title: pullRequest.draft
				? `📝 Utkast til PR #${pullRequest.number} ble opprettet`
				: `🔀 PR #${pullRequest.number} ble åpnet`,
			url: pullRequest.html_url,
		};
	}

	if (action === "ready_for_review") {
		notification = {
			color: colors.info,
			description,
			title: `👀 PR #${pullRequest.number} er klar for gjennomgang`,
			url: pullRequest.html_url,
		};
	}

	if (action === "review_requested") {
		const reviewer =
			event.requested_reviewer?.login ?? event.requested_team?.name;
		notification = {
			color: colors.info,
			description: reviewer
				? `${description}\n\nGjennomgang ønskes fra **${truncate(reviewer, 100)}**.`
				: description,
			title: `👀 Gjennomgang ønskes på PR #${pullRequest.number}`,
			url: pullRequest.html_url,
		};
	}

	if (action === "closed") {
		notification = {
			color: pullRequest.merged ? colors.success : colors.info,
			description,
			title: pullRequest.merged
				? `✅ PR #${pullRequest.number} ble slått sammen`
				: `🚫 PR #${pullRequest.number} ble lukket uten merge`,
			url: pullRequest.html_url,
		};
	}
}

if (eventName === "pull_request_review") {
	const pullRequest = event.pull_request;
	const reviewState = event.review?.state?.toLocaleLowerCase("en-US");
	const description = linkedTitle(pullRequest.title, pullRequest.html_url);

	if (reviewState === "approved") {
		notification = {
			color: colors.success,
			description,
			title: `👍 PR #${pullRequest.number} ble godkjent`,
			url: event.review.html_url ?? pullRequest.html_url,
		};
	}

	if (reviewState === "changes_requested") {
		notification = {
			color: colors.warning,
			description,
			title: `🔁 Endringer ble etterspurt på PR #${pullRequest.number}`,
			url: event.review.html_url ?? pullRequest.html_url,
		};
	}
}

if (eventName === "release" && action === "published") {
	const release = event.release;
	notification = {
		color: colors.success,
		description: linkedTitle(
			release.name || release.tag_name,
			release.html_url,
		),
		title: `🏷️ Versjon ${truncate(release.tag_name, 100)} ble publisert`,
		url: release.html_url,
	};
}

if (eventName === "check_run") {
	const checkRun = event.check_run;
	const branch =
		checkRun.check_suite?.head_branch ??
		checkRun.pull_requests?.[0]?.head?.ref;
	const isCloudflareBuild =
		checkRun.app?.slug === "cloudflare-workers-and-pages" &&
		checkRun.name === "Workers Builds: tb-notearkiv";
	const isPreview = /Preview URL:/i.test(checkRun.output?.summary ?? "");
	const isProduction = productionBranches.has(branch) && !isPreview;
	const conclusion = checkRun.conclusion?.toLocaleLowerCase("en-US");
	const commit = truncate(checkRun.head_sha, 12);
	const description = [
		branch ? `Branch \`${truncate(branch, 100)}\`.` : undefined,
		commit ? `Commit \`${commit}\`.` : undefined,
	]
		.filter(Boolean)
		.join(" ");

	if (isCloudflareBuild && isProduction && conclusion === "success") {
		notification = {
			color: colors.success,
			description,
			title: "🚀 Notearkivet ble deployet",
			url:
				checkRun.details_url ||
				checkRun.html_url ||
				"https://intern.tertnesbrass.com",
		};
	}

	if (
		isCloudflareBuild &&
		isProduction &&
		["action_required", "cancelled", "failure", "timed_out"].includes(
			conclusion,
		)
	) {
		notification = {
			color: colors.failure,
			description,
			title: "🔥 Produksjonsdeploy feilet",
			url:
				checkRun.details_url ||
				checkRun.html_url ||
				repository.html_url,
		};
	}
}

if (!notification) {
	await appendFile(outputPath, "notify=false\n");
	process.exit(0);
}

const discordPayload = {
	allowed_mentions: { parse: [] },
	avatar_url: repository.owner?.avatar_url,
	embeds: [
		{
			author: actor.login
				? {
						icon_url: actor.avatar_url,
						name: actor.login,
						url: actor.html_url,
					}
				: undefined,
			color: notification.color,
			description: truncate(notification.description, 4_096),
			footer: { text: repository.full_name ?? "Tertnes Brass" },
			timestamp: new Date().toISOString(),
			title: truncate(notification.title, 256),
			url: notification.url,
		},
	],
	username: truncate(repository.name || "Tertnes Brass", 80),
};

await writeFile(payloadPath, `${JSON.stringify(discordPayload)}\n`);
await appendFile(outputPath, "notify=true\n");
