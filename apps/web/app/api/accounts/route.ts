import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const search = searchParams.get("search");

    const accounts = await prisma.account.findMany({
      where: {
        organisationId: session.organisationId,
        ...(type ? { type: type as any } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { code: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    });

    return NextResponse.json({ accounts });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const { name, type, code } = body ?? {};

    if (!name || !type || !code) {
      throw new ApiError("name, type and code are required", 400);
    }

    const account = await prisma.account.create({
      data: {
        organisationId: session.organisationId,
        name,
        type,
        code,
      },
    });

    return NextResponse.json({ account }, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "An account with this code already exists" }, { status: 409 });
    }
    return handleApiError(err);
  }
}
