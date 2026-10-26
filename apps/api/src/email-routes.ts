import { demand, uuid } from "../../../packages/contracts/src/index";
import {
  emailReplyInput,
  queueEmailReply,
} from "../../../packages/core/src/email";
import type { CommandRoute } from "./completion-routes";
export function emailRoutes(route: CommandRoute) {
  route(
    "POST",
    "/conversations/:id/email/send",
    emailReplyInput,
    (db, actor, request) => {
      const key = String(request.headers["idempotency-key"] || "");
      demand(
        key.length >= 8 && key.length <= 120 && /^[A-Za-z0-9:_/.-]+$/.test(key),
        "IDEMPOTENCY_REQUIRED",
        "Informe Idempotency-Key válido",
        400,
      );
      return queueEmailReply(
        db,
        actor,
        uuid.parse(request.params.id),
        request.body,
        key,
      );
    },
  );
}
