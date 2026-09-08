import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import profilesRouter from "./profiles";
import customersRouter from "./customers";
import suppliersRouter from "./suppliers";
import toursRouter from "./tours";
import quotationsRouter from "./quotations";
import operationsRouter from "./operations";
import notificationsRouter from "./notifications";
import settingsRouter from "./settings";
import dashboardRouter from "./dashboard";
import aiRouter from "./ai";
import usersRouter from "./users";
import accountingRouter from "./accounting";
import accountingExportRouter from "./accounting-export";
import guideRouter from "./guide";
import fieldRouter from "./field";
import rolesRouter from "./roles";
import systemRouter from "./system";
import auditRouter from "./audit";
import reservationsRouter from "./reservations";
import reservationRecordsRouter from "./reservation-records";
import outlookRouter from "./outlook";
import contactRouter from "./contact";
import communicationsRouter from "./communications";
import externalObservationsRouter from "./external-observations";
import sheetImportRouter from "./sheet-import";
import historicalRemediationRouter from "./historical-remediation";
import resourcesRouter from "./resources";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use("/profiles", profilesRouter);
router.use("/customers", customersRouter);
router.use("/suppliers", suppliersRouter);
router.use("/tours", toursRouter);
router.use("/quotations", quotationsRouter);
router.use("/operations", operationsRouter);
router.use("/notifications", notificationsRouter);
router.use(settingsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/ai", aiRouter);
router.use("/", usersRouter);
router.use("/accounting/export", accountingExportRouter);
router.use("/accounting", accountingRouter);
router.use("/guide", guideRouter);
router.use("/field", fieldRouter);
router.use("/roles", rolesRouter);
router.use("/system", systemRouter);
router.use("/audit", auditRouter);
// outlookRouter must mount before reservationsRouter: reservations.ts has
// generic single-segment routes (GET /:id, DELETE /:id) that would otherwise
// swallow /outlook-connection and /outlook-scan before Express ever reaches
// outlook.ts's more specific literal routes.
router.use("/reservations", outlookRouter);
router.use("/reservations", reservationsRouter);
router.use("/reservation-records", reservationRecordsRouter);
router.use(contactRouter);
router.use("/communications", communicationsRouter);
router.use("/external-observations", externalObservationsRouter);
router.use("/sheet-import", sheetImportRouter);
router.use("/historical-remediation", historicalRemediationRouter);
router.use("/resources", resourcesRouter);

export default router;
