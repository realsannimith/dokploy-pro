import { describe, expect, it } from "vitest";
import {
	buildApplicationDomainUrl,
	getFirstEnabledApplicationDomainLink,
} from "@/components/dashboard/application/application-domain-link";

describe("application domain links", () => {
	it("selects the first enabled domain and includes its configured path", () => {
		const link = getFirstEnabledApplicationDomainLink([
			{
				enabled: false,
				host: "disabled.example.com",
				https: true,
				path: "/",
			},
			{
				enabled: true,
				host: "app.example.com",
				https: true,
				path: "/dashboard",
			},
			{
				enabled: true,
				host: "later.example.com",
				https: false,
				path: "/",
			},
		]);

		expect(link).toEqual({
			href: "https://app.example.com/dashboard",
			host: "app.example.com",
			isTemporaryHttpDomain: false,
		});
	});

	it("marks only HTTP sslip.io addresses as temporary", () => {
		expect(
			getFirstEnabledApplicationDomainLink([
				{
					enabled: true,
					host: "demo.203-0-113-10.sslip.io",
					https: false,
					path: "/",
				},
			]),
		).toMatchObject({
			href: "http://demo.203-0-113-10.sslip.io/",
			isTemporaryHttpDomain: true,
		});

		expect(
			getFirstEnabledApplicationDomainLink([
				{
					enabled: true,
					host: "demo.203-0-113-10.sslip.io",
					https: true,
					path: "/",
				},
			]),
		).toMatchObject({ isTemporaryHttpDomain: false });
	});

	it("does not allow a path to replace the configured host", () => {
		const href = buildApplicationDomainUrl({
			host: "app.example.com",
			https: false,
			path: "//attacker.example.com/login",
		});

		expect(href).toBe("http://app.example.com//attacker.example.com/login");
		expect(new URL(href || "").host).toBe("app.example.com");
	});

	it("rejects hosts that could inject URL credentials or a different scheme", () => {
		expect(
			buildApplicationDomainUrl({
				host: "trusted.example.com@attacker.example.com",
				https: true,
				path: "/",
			}),
		).toBeNull();
		expect(
			buildApplicationDomainUrl({
				host: "javascript://attacker.example.com",
				https: false,
				path: "/",
			}),
		).toBeNull();
	});

	it("returns no link when every domain is disabled", () => {
		expect(
			getFirstEnabledApplicationDomainLink([
				{
					enabled: false,
					host: "app.example.com",
					https: true,
					path: "/",
				},
			]),
		).toBeNull();
	});
});
