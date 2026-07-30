import { apiClient } from "@/services/api/client";
import {
  fetchFancyNumbers,
  fetchMyFancyNumber,
} from "@/services/api/fancy-number";
import { fetchGroupExpansionProducts } from "@/services/api/group-expansion";

jest.mock("@/i18n", () => ({
  __esModule: true,
  default: {
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? "invalid response",
  },
}));

jest.mock("@/services/api/client", () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

beforeEach(() => {
  mockedApiClient.mockReset();
});

test.each([100.5, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid fancy-number catalog unit price %s",
  async (unitPrice) => {
    mockedApiClient.mockResolvedValue({
      items: [{ id: "fancy-1", value: "888888" }],
      nextCursor: null,
      unitPrice,
      minMonths: 1,
      maxMonths: 12,
      purchaseMode: "PAID_MONTHLY",
    });

    await expect(fetchFancyNumbers()).rejects.toThrow();
  },
);

test("rejects a fractional active fancy-number lease price", async () => {
  mockedApiClient.mockResolvedValue({
    active: true,
    accountId: "888888",
    restoreAccountId: "NORMAL1",
    startedAt: "2026-07-29T00:00:00.000Z",
    expiresAt: "2026-08-29T00:00:00.000Z",
    permanent: false,
    renewable: true,
    unitPrice: 100.5,
  });

  await expect(fetchMyFancyNumber()).rejects.toThrow();
});

test("rejects duplicate group-expansion product IDs", async () => {
  mockedApiClient.mockResolvedValue({
    circleId: "circle-1",
    memberCount: 20,
    currentMaxMembers: 100,
    expansionSeats: 0,
    hardLimit: 500,
    products: [
      {
        id: "product-1",
        name: "100 seats",
        seats: 100,
        price: 100,
        purchasable: true,
        unavailableReason: null,
        resultingMaxMembers: 200,
      },
      {
        id: "product-1",
        name: "200 seats",
        seats: 200,
        price: 180,
        purchasable: true,
        unavailableReason: null,
        resultingMaxMembers: 300,
      },
    ],
  });

  await expect(fetchGroupExpansionProducts("circle-1")).rejects.toThrow();
});
