import { validateRequest } from "@dokploy/server";
import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import superjson from "superjson";
import { AgentChat } from "@/components/dashboard/settings/agent/agent-chat";
import { AgentForm } from "@/components/dashboard/settings/agent/agent-form";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { appRouter } from "@/server/api/root";

const Page = () => {
	return (
		<div className="flex flex-col gap-4 w-full">
			<AgentForm />
			<AgentChat />
		</div>
	);
};

export default Page;

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { req, res } = ctx;
	const { user, session } = await validateRequest(req);

	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: req as any,
			res: res as any,
			db: null as any,
			session: session as any,
			user: user as any,
		},
		transformer: superjson,
	});

	await helpers.settings.isCloud.prefetch();
	await helpers.user.get.prefetch();

	if (!user || user.role === "member") {
		return {
			redirect: {
				permanent: false,
				destination: "/",
			},
		};
	}
	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	};
}
