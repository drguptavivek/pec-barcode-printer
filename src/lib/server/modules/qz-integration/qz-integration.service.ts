import {
	type KeyObject,
	X509Certificate,
	createHash,
	createPublicKey,
	createSign,
	generateKeyPairSync,
	randomBytes
} from 'node:crypto';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { AppError } from '$lib/server/observability/errors';
import { logger } from '$lib/server/observability/logger';
import { writeAudit } from '$lib/server/observability/audit';
import { decryptSecret, encryptSecret, encryptionKeyStatus } from './qz-crypto';
import { qzCredentialKeys, QzIntegrationRepository } from './qz-integration.repository';

type QzIntegrationConfig = Record<string, string | undefined> & {
	QZ_CREDENTIAL_ENCRYPTION_KEY?: string;
};

type QzSettingRecord = {
	value: string;
	updatedAt: Date | null;
};

type QzCredentialRepository = {
	get(key: string): PromiseLike<QzSettingRecord[]>;
	upsert(input: {
		key: string;
		value: string;
		description: string;
		updatedBy: string;
	}): PromiseLike<unknown>;
};

const CERTIFICATE_BEGIN = '-----BEGIN CERTIFICATE-----';
const PRIVATE_KEY_BEGIN = '-----BEGIN';
const SHA512_WITH_RSA_ENCRYPTION_OID = '1.2.840.113549.1.1.13';
const COMMON_CERTIFICATE_DN = {
	country: 'IN',
	state: 'Delhi',
	locality: 'Delhi',
	organization: 'VCMS',
	organizationalUnit: 'QZ Tray'
};

type SecretStatus = {
	configured: boolean;
	source: 'database';
	readable: boolean;
	keyId?: string;
	updatedAt?: Date;
	error?: string;
};

type QzIntegrationStatus = {
	rootCaCertificate: SecretStatus;
	rootCaPrivateKey: SecretStatus;
	certificate: SecretStatus;
	privateKey: SecretStatus;
	privateKeyPassphraseConfigured: boolean;
	encryptionKey: { configured: boolean; keyId: string | null };
	signingAlgorithm: 'SHA512';
	certificateEndpoint: string;
	signingEndpoint: string;
};

export class QzIntegrationService {
	constructor(
		private readonly repository: QzCredentialRepository = new QzIntegrationRepository(),
		private readonly config: QzIntegrationConfig = env
	) {}

	async getStatus(): Promise<QzIntegrationStatus> {
		const [
			rootCaCertificateStatus,
			rootCaPrivateKeyStatus,
			certificateStatus,
			privateKeyStatus,
			privateKeyPassphraseStatus
		] = await Promise.all([
			this.getDbSecretStatus(qzCredentialKeys.rootCaCertificate, CERTIFICATE_BEGIN),
			this.getDbSecretStatus(qzCredentialKeys.rootCaPrivateKey, PRIVATE_KEY_BEGIN),
			this.getDbSecretStatus(qzCredentialKeys.certificate, CERTIFICATE_BEGIN),
			this.getDbSecretStatus(qzCredentialKeys.privateKey, PRIVATE_KEY_BEGIN),
			this.getDbSecretStatus(qzCredentialKeys.privateKeyPassphrase, '')
		]);

		return {
			rootCaCertificate: rootCaCertificateStatus,
			rootCaPrivateKey: rootCaPrivateKeyStatus,
			certificate: certificateStatus,
			privateKey: privateKeyStatus,
			privateKeyPassphraseConfigured: privateKeyPassphraseStatus.configured,
			encryptionKey: encryptionKeyStatus(this.config.QZ_CREDENTIAL_ENCRYPTION_KEY),
			signingAlgorithm: 'SHA512',
			certificateEndpoint: '/api/v1/qz/certificate',
			signingEndpoint: '/api/v1/qz/sign'
		};
	}

	async saveCredentials(input: {
		rootCaCertificatePem?: string;
		rootCaPrivateKeyPem?: string;
		certificatePem: string;
		privateKeyPem: string;
		privateKeyPassphrase?: string;
		reason: string;
		userId: string;
		requestId: string;
		ipAddress?: string;
		userAgent?: string;
	}) {
		const rootCaCertificate = input.rootCaCertificatePem?.trim() ?? '';
		const rootCaPrivateKey = input.rootCaPrivateKeyPem?.trim() ?? '';
		const certificate = input.certificatePem.trim();
		const privateKey = input.privateKeyPem.trim();
		const passphrase = input.privateKeyPassphrase?.trim() ?? '';

		if (!certificate.includes(CERTIFICATE_BEGIN)) {
			throw new AppError('QZ_CERTIFICATE_INVALID', 'QZ Tray certificate is invalid.', 400);
		}
		if (!privateKey.includes(PRIVATE_KEY_BEGIN)) {
			throw new AppError('QZ_PRIVATE_KEY_INVALID', 'QZ Tray private key is invalid.', 400);
		}
		if (rootCaCertificate && !rootCaCertificate.includes(CERTIFICATE_BEGIN)) {
			throw new AppError('QZ_ROOT_CA_INVALID', 'QZ Tray root CA certificate is invalid.', 400);
		}
		if (rootCaPrivateKey && !rootCaPrivateKey.includes(PRIVATE_KEY_BEGIN)) {
			throw new AppError('QZ_ROOT_CA_KEY_INVALID', 'QZ Tray root CA private key is invalid.', 400);
		}

		const before = await this.getStatus();
		const masterKey = this.requireMasterKey();
		const encryptedRootCaCertificate = rootCaCertificate
			? encryptSecret(rootCaCertificate, masterKey)
			: null;
		const encryptedRootCaPrivateKey = rootCaPrivateKey
			? encryptSecret(rootCaPrivateKey, masterKey)
			: null;
		const encryptedCertificate = encryptSecret(certificate, masterKey);
		const encryptedPrivateKey = encryptSecret(privateKey, masterKey);
		const encryptedPassphrase = passphrase ? encryptSecret(passphrase, masterKey) : null;

		if (encryptedRootCaCertificate) {
			await this.repository.upsert({
				key: qzCredentialKeys.rootCaCertificate,
				value: JSON.stringify(encryptedRootCaCertificate),
				description: 'Encrypted QZ Tray VCMS root CA certificate',
				updatedBy: input.userId
			});
		}
		if (encryptedRootCaPrivateKey) {
			await this.repository.upsert({
				key: qzCredentialKeys.rootCaPrivateKey,
				value: JSON.stringify(encryptedRootCaPrivateKey),
				description: 'Encrypted QZ Tray VCMS root CA private key',
				updatedBy: input.userId
			});
		}
		await this.repository.upsert({
			key: qzCredentialKeys.certificate,
			value: JSON.stringify(encryptedCertificate),
			description: 'Encrypted QZ Tray browser signing certificate',
			updatedBy: input.userId
		});
		await this.repository.upsert({
			key: qzCredentialKeys.privateKey,
			value: JSON.stringify(encryptedPrivateKey),
			description: 'Encrypted QZ Tray private signing key',
			updatedBy: input.userId
		});
		if (encryptedPassphrase) {
			await this.repository.upsert({
				key: qzCredentialKeys.privateKeyPassphrase,
				value: JSON.stringify(encryptedPassphrase),
				description: 'Encrypted QZ Tray private key passphrase',
				updatedBy: input.userId
			});
		}

		await writeAudit(db, {
			requestId: input.requestId,
			actorUserId: input.userId,
			action: 'qz.credentials.update',
			resourceType: 'system',
			resourceId: 'qz-tray',
			reason: input.reason,
			before,
			after: await this.getStatus(),
			ipAddress: input.ipAddress,
			userAgent: input.userAgent
		});

		return this.getStatus();
	}

	async generateAndSaveCredentials(input: {
		reason: string;
		userId: string;
		requestId: string;
		ipAddress?: string;
		userAgent?: string;
	}) {
		const generated = await this.generateCredentials();
		await this.saveCredentials({
			...generated,
			reason: input.reason,
			userId: input.userId,
			requestId: input.requestId,
			ipAddress: input.ipAddress,
			userAgent: input.userAgent
		});
		return this.getCurrentCredentials();
	}

	async getCurrentCredentials() {
		return {
			rootCaCertificatePem: await this.readOptionalDbSecretForDisplay(
				qzCredentialKeys.rootCaCertificate
			),
			rootCaPrivateKeyPem: await this.readOptionalDbSecretForDisplay(
				qzCredentialKeys.rootCaPrivateKey
			),
			certificatePem: await this.readOptionalDbSecretForDisplay(qzCredentialKeys.certificate),
			privateKeyPem: await this.readOptionalDbSecretForDisplay(qzCredentialKeys.privateKey),
			privateKeyPassphrase: await this.readOptionalDbSecretForDisplay(
				qzCredentialKeys.privateKeyPassphrase
			)
		};
	}

	async getCurrentPublicCertificates() {
		const rootCaCertificatePem = await this.readOptionalDbSecretForDisplay(
			qzCredentialKeys.rootCaCertificate
		);
		return {
			rootCaCertificatePem,
			rootCaFingerprint: rootCaCertificatePem ? certificateFingerprint(rootCaCertificatePem) : '',
			certificatePem: await this.readOptionalDbSecretForDisplay(qzCredentialKeys.certificate)
		};
	}

	async getCertificate() {
		const certificate = await this.readDbSecret(
			qzCredentialKeys.certificate,
			CERTIFICATE_BEGIN,
			'QZ certificate'
		);
		return { certificate };
	}

	async getRootCaCertificate() {
		const certificate = await this.readDbSecret(
			qzCredentialKeys.rootCaCertificate,
			CERTIFICATE_BEGIN,
			'QZ root CA certificate'
		);
		return { certificate };
	}

	async sign(input: { toSign: string }) {
		const [privateKey, passphrase] = await Promise.all([
			this.readDbSecret(qzCredentialKeys.privateKey, PRIVATE_KEY_BEGIN, 'QZ private key'),
			this.readOptionalDbSecret(qzCredentialKeys.privateKeyPassphrase)
		]);

		try {
			const signer = createSign('SHA512');
			signer.update(input.toSign, 'utf8');
			signer.end();
			const signature = signer.sign(
				{
					key: privateKey,
					passphrase: passphrase || undefined
				},
				'base64'
			);
			return { signature };
		} catch (error) {
			logger.error({ err: error instanceof Error ? error.message : error }, 'QZ signing failed');
			throw new AppError('QZ_SIGNING_FAILED', 'QZ Tray signing failed.', 500);
		}
	}

	private async getDbSecretStatus(key: string, requiredMarker: string): Promise<SecretStatus> {
		const [setting] = await this.repository.get(key);
		if (!setting) return { configured: false, source: 'database', readable: false };

		try {
			const payload = JSON.parse(setting.value) as unknown;
			const decrypted = decryptSecret(payload, this.requireMasterKey());
			const markerOk = requiredMarker ? decrypted.includes(requiredMarker) : true;
			return {
				configured: true,
				source: 'database',
				readable: markerOk,
				keyId:
					typeof payload === 'object' && payload
						? String((payload as { keyId?: string }).keyId)
						: undefined,
				updatedAt: setting.updatedAt ?? undefined,
				error: markerOk ? undefined : 'Stored credential is malformed.'
			};
		} catch (error) {
			return {
				configured: true,
				source: 'database',
				readable: false,
				updatedAt: setting.updatedAt ?? undefined,
				error: error instanceof Error ? error.message : 'Stored credential is not readable.'
			};
		}
	}

	private async readDbSecret(key: string, requiredMarker: string, label: string) {
		const [setting] = await this.repository.get(key);
		if (!setting)
			throw new AppError('QZ_CREDENTIAL_NOT_CONFIGURED', `${label} is not configured.`, 500);
		const value = decryptSecret(JSON.parse(setting.value) as unknown, this.requireMasterKey());
		if (!value.includes(requiredMarker)) {
			throw new AppError('QZ_CREDENTIAL_INVALID', `${label} is invalid.`, 500);
		}
		return value;
	}

	private async readOptionalDbSecret(key: string) {
		const [setting] = await this.repository.get(key);
		if (!setting) return '';
		return decryptSecret(JSON.parse(setting.value) as unknown, this.requireMasterKey());
	}

	private async readOptionalDbSecretForDisplay(key: string) {
		try {
			return await this.readOptionalDbSecret(key);
		} catch {
			return '';
		}
	}

	private async generateCredentials() {
		try {
			const rootKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
			const leafKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
			const rootSubject = {
				...COMMON_CERTIFICATE_DN,
				commonName: 'VCMS QZ Tray Local Root CA'
			};
			const leafSubject = {
				...COMMON_CERTIFICATE_DN,
				commonName: 'VCMS QZ Browser Signing'
			};
			const rootCaPrivateKeyPem = exportRsaPrivateKeyPem(rootKeyPair.privateKey);
			const privateKeyPem = exportRsaPrivateKeyPem(leafKeyPair.privateKey);
			const rootCaCertificatePem = createCertificatePem({
				subject: rootSubject,
				issuer: rootSubject,
				subjectPublicKey: rootKeyPair.publicKey,
				issuerPrivateKey: rootKeyPair.privateKey,
				issuerPublicKey: rootKeyPair.publicKey,
				daysValid: 3650,
				isCa: true
			});
			const certificatePem = createCertificatePem({
				subject: leafSubject,
				issuer: rootSubject,
				subjectPublicKey: leafKeyPair.publicKey,
				issuerPrivateKey: rootKeyPair.privateKey,
				issuerPublicKey: rootKeyPair.publicKey,
				daysValid: 825,
				isCa: false
			});

			return {
				rootCaCertificatePem,
				rootCaPrivateKeyPem,
				certificatePem,
				privateKeyPem,
				privateKeyPassphrase: ''
			};
		} catch (error) {
			logger.error(
				{ err: error instanceof Error ? error.message : error },
				'QZ autogenerate failed'
			);
			throw new AppError('QZ_CREDENTIAL_GENERATE_FAILED', 'QZ credential generation failed.', 500);
		}
	}

	private requireMasterKey() {
		const masterKey = this.config.QZ_CREDENTIAL_ENCRYPTION_KEY;
		if (!masterKey?.trim()) {
			throw new AppError(
				'QZ_CREDENTIAL_KEY_MISSING',
				'QZ credential encryption key is not configured.',
				500
			);
		}
		return masterKey;
	}
}

export const qzIntegrationService = new QzIntegrationService();

function certificateFingerprint(pem: string) {
	try {
		const certificate = new X509Certificate(pem);
		return createHash('sha1').update(certificate.raw).digest('hex');
	} catch {
		return '';
	}
}

type CertificateName = typeof COMMON_CERTIFICATE_DN & {
	commonName: string;
};

type CertificateInput = {
	subject: CertificateName;
	issuer: CertificateName;
	subjectPublicKey: KeyObject;
	issuerPrivateKey: KeyObject;
	issuerPublicKey: KeyObject;
	daysValid: number;
	isCa: boolean;
};

function createCertificatePem(input: CertificateInput) {
	const now = new Date();
	const notBefore = new Date(now.getTime() - 60_000);
	const notAfter = new Date(now.getTime() + input.daysValid * 24 * 60 * 60 * 1000);
	const tbsCertificate = derSequence([
		derExplicit(0, derInteger(2)),
		derInteger(randomPositiveSerial()),
		algorithmIdentifier(SHA512_WITH_RSA_ENCRYPTION_OID),
		distinguishedName(input.issuer),
		derSequence([derUtcTime(notBefore), derUtcTime(notAfter)]),
		distinguishedName(input.subject),
		input.subjectPublicKey.export({ type: 'spki', format: 'der' }),
		derExplicit(3, certificateExtensions(input))
	]);
	const signer = createSign('RSA-SHA512');
	signer.update(tbsCertificate);
	signer.end();
	const signature = signer.sign(input.issuerPrivateKey);
	const certificate = derSequence([
		tbsCertificate,
		algorithmIdentifier(SHA512_WITH_RSA_ENCRYPTION_OID),
		derBitString(signature, 0)
	]);

	return pemBlock('CERTIFICATE', certificate);
}

function certificateExtensions(input: CertificateInput) {
	const subjectKeyIdentifier = keyIdentifier(input.subjectPublicKey);
	const authorityKeyIdentifier = keyIdentifier(input.issuerPublicKey);
	const extensions = [
		extension('2.5.29.19', true, derSequence(input.isCa ? [derBoolean(true)] : [])),
		extension(
			'2.5.29.15',
			true,
			input.isCa ? derBitString(Buffer.from([0x06]), 1) : derBitString(Buffer.from([0x80]), 7)
		),
		extension('2.5.29.14', false, derOctetString(subjectKeyIdentifier)),
		extension('2.5.29.35', false, derSequence([derContextPrimitive(0, authorityKeyIdentifier)]))
	];
	if (!input.isCa) {
		extensions.splice(
			2,
			0,
			extension('2.5.29.37', false, derSequence([derObjectIdentifier('1.3.6.1.5.5.7.3.3')]))
		);
	}
	return derSequence(extensions);
}

function extension(oid: string, critical: boolean, value: Buffer) {
	const fields = [derObjectIdentifier(oid)];
	if (critical) fields.push(derBoolean(true));
	fields.push(derOctetString(value));
	return derSequence(fields);
}

function distinguishedName(name: CertificateName) {
	return derSequence([
		relativeDistinguishedName('2.5.4.6', name.country, 'printable'),
		relativeDistinguishedName('2.5.4.8', name.state),
		relativeDistinguishedName('2.5.4.7', name.locality),
		relativeDistinguishedName('2.5.4.10', name.organization),
		relativeDistinguishedName('2.5.4.11', name.organizationalUnit),
		relativeDistinguishedName('2.5.4.3', name.commonName)
	]);
}

function relativeDistinguishedName(
	oid: string,
	value: string,
	encoding: 'utf8' | 'printable' = 'utf8'
) {
	const encodedValue = encoding === 'printable' ? derPrintableString(value) : derUtf8String(value);
	return derSet([derSequence([derObjectIdentifier(oid), encodedValue])]);
}

function keyIdentifier(key: KeyObject) {
	const publicKey = key.type === 'public' ? key : createPublicKey(key);
	const spki = publicKey.export({ type: 'spki', format: 'der' });
	return createHash('sha1').update(spki).digest();
}

function exportRsaPrivateKeyPem(key: KeyObject) {
	return key.export({ type: 'pkcs1', format: 'pem' }).toString();
}

function randomPositiveSerial() {
	const serial = randomBytes(16);
	serial[0] &= 0x7f;
	if (serial[0] === 0) serial[0] = 1;
	return serial;
}

function pemBlock(label: string, der: Buffer) {
	const body = der
		.toString('base64')
		.replace(/.{1,64}/g, '$&\n')
		.trimEnd();
	return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function algorithmIdentifier(oid: string) {
	return derSequence([derObjectIdentifier(oid), Buffer.from([0x05, 0x00])]);
}

function derSequence(values: Buffer[]) {
	return derConstructed(0x30, values);
}

function derSet(values: Buffer[]) {
	return derConstructed(0x31, values);
}

function derExplicit(tag: number, value: Buffer) {
	return der(0xa0 + tag, value);
}

function derContextPrimitive(tag: number, value: Buffer) {
	return der(0x80 + tag, value);
}

function derConstructed(tag: number, values: Buffer[]) {
	return der(tag, Buffer.concat(values));
}

function derInteger(value: number | Buffer) {
	if (typeof value === 'number') {
		if (value === 0) return der(0x02, Buffer.from([0]));
		const bytes: number[] = [];
		let remaining = value;
		while (remaining > 0) {
			bytes.unshift(remaining & 0xff);
			remaining >>= 8;
		}
		if (bytes[0] & 0x80) bytes.unshift(0);
		return der(0x02, Buffer.from(bytes));
	}
	const needsPositivePadding = (value[0] & 0x80) !== 0;
	return der(0x02, needsPositivePadding ? Buffer.concat([Buffer.from([0]), value]) : value);
}

function derBoolean(value: boolean) {
	return der(0x01, Buffer.from([value ? 0xff : 0x00]));
}

function derBitString(value: Buffer, unusedBits: number) {
	return der(0x03, Buffer.concat([Buffer.from([unusedBits]), value]));
}

function derOctetString(value: Buffer) {
	return der(0x04, value);
}

function derPrintableString(value: string) {
	return der(0x13, Buffer.from(value, 'ascii'));
}

function derUtf8String(value: string) {
	return der(0x0c, Buffer.from(value, 'utf8'));
}

function derUtcTime(value: Date) {
	const year = value.getUTCFullYear() % 100;
	const parts = [
		year,
		value.getUTCMonth() + 1,
		value.getUTCDate(),
		value.getUTCHours(),
		value.getUTCMinutes(),
		value.getUTCSeconds()
	].map((part) => String(part).padStart(2, '0'));
	return der(0x17, Buffer.from(`${parts.join('')}Z`, 'ascii'));
}

function derObjectIdentifier(oid: string) {
	const parts = oid.split('.').map((part) => Number(part));
	const [first, second, ...rest] = parts;
	if (first === undefined || second === undefined) throw new Error(`Invalid OID: ${oid}`);
	return der(0x06, Buffer.from([first * 40 + second, ...rest.flatMap(base128)]));
}

function base128(value: number) {
	if (value === 0) return [0];
	const bytes: number[] = [];
	let remaining = value;
	while (remaining > 0) {
		bytes.unshift(remaining & 0x7f);
		remaining >>= 7;
	}
	return bytes.map((byte, index) => (index === bytes.length - 1 ? byte : byte | 0x80));
}

function der(tag: number, value: Buffer) {
	return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]);
}

function derLength(length: number) {
	if (length < 0x80) return Buffer.from([length]);
	const bytes: number[] = [];
	let remaining = length;
	while (remaining > 0) {
		bytes.unshift(remaining & 0xff);
		remaining >>= 8;
	}
	return Buffer.from([0x80 | bytes.length, ...bytes]);
}
