export const canGenerateOrganizationScimToken = ({
	organizationId,
}: {
	organizationId?: string;
}) => typeof organizationId === "string" && organizationId.length > 0;
